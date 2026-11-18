/**
 * Core type definitions + the type-level inference engine.
 * Everything here is erased at runtime — no imports with side effects.
 */
import type { DatabaseAdapter, StorageAdapter } from "../adapters/types";

/* -------------------------------------------------------------------------- */
/*                                   Utils                                    */
/* -------------------------------------------------------------------------- */

/** Flattens intersections so editor hovers show a single object. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/* -------------------------------------------------------------------------- */
/*                                  Rich text                                 */
/* -------------------------------------------------------------------------- */

export interface RichTextMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** A ProseMirror / Tiptap JSON node. */
export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
}

/** A ProseMirror / Tiptap JSON document (`editor.getJSON()`). */
export interface RichTextDocument {
  type: "doc";
  content?: RichTextNode[];
}

/* -------------------------------------------------------------------------- */
/*                                   Fields                                   */
/* -------------------------------------------------------------------------- */

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "richText"
  | "media"
  | "relation";

export interface FieldAdminOptions {
  description?: string;
  hidden?: boolean;
  readOnly?: boolean;
  position?: "main" | "sidebar";
  placeholder?: string;
}

export interface FieldValidateContext {
  /** The (parsed) sibling data of the document being validated. */
  data: Record<string, unknown>;
}

/** Return `true` when valid, or an error message. */
export type FieldValidateFn<V> = (value: V, ctx: FieldValidateContext) => true | string;

export interface BaseFieldOptions<V> {
  label?: string;
  required?: boolean;
  defaultValue?: V;
  admin?: FieldAdminOptions;
  validate?: FieldValidateFn<V>;
}

export interface TextFieldOptions extends BaseFieldOptions<string> {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
}

export interface TextareaFieldOptions extends BaseFieldOptions<string> {
  minLength?: number;
  maxLength?: number;
  rows?: number;
}

export interface NumberFieldOptions extends BaseFieldOptions<number> {
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface BooleanFieldOptions extends BaseFieldOptions<boolean> {}

export type SelectOption = string | { readonly label: string; readonly value: string };

export interface SelectFieldOptions extends BaseFieldOptions<string | readonly string[]> {
  options: readonly SelectOption[];
  hasMany?: boolean;
}

export interface RichTextFieldOptions extends BaseFieldOptions<RichTextDocument> {}

export interface RelationshipFieldOptions extends BaseFieldOptions<string | readonly string[]> {
  /** Slug of the target collection. */
  relationTo: string;
  hasMany?: boolean;
}

export type TextField<O extends TextFieldOptions = TextFieldOptions> = { readonly type: "text" } & O;
export type TextareaField<O extends TextareaFieldOptions = TextareaFieldOptions> = {
  readonly type: "textarea";
} & O;
export type NumberField<O extends NumberFieldOptions = NumberFieldOptions> = {
  readonly type: "number";
} & O;
export type BooleanField<O extends BooleanFieldOptions = BooleanFieldOptions> = {
  readonly type: "boolean";
} & O;
export type SelectField<O extends SelectFieldOptions = SelectFieldOptions> = {
  readonly type: "select";
} & O;
export type RichTextField<O extends RichTextFieldOptions = RichTextFieldOptions> = {
  readonly type: "richText";
} & O;
export type MediaField<O extends RelationshipFieldOptions = RelationshipFieldOptions> = {
  readonly type: "media";
} & O;
export type RelationField<O extends RelationshipFieldOptions = RelationshipFieldOptions> = {
  readonly type: "relation";
} & O;

export type Field =
  | TextField
  | TextareaField
  | NumberField
  | BooleanField
  | SelectField
  | RichTextField
  | MediaField
  | RelationField;

export type FieldsMap = { readonly [key: string]: Field };

/* -------------------------------------------------------------------------- */
/*                                 Collections                                */
/* -------------------------------------------------------------------------- */

export type DocumentStatus = "draft" | "published";

export type XenonRole = "admin" | "editor";

export interface XenonUser {
  id: string;
  email: string;
  name?: string | null;
  role: XenonRole;
}

export type AccessFn = (args: { user: XenonUser | null }) => boolean | Promise<boolean>;

export interface CollectionAccess {
  read?: AccessFn;
  create?: AccessFn;
  update?: AccessFn;
  delete?: AccessFn;
}

export interface UploadOptions {
  /** Allowed MIME types, supports wildcards like `image/*`. */
  mimeTypes?: readonly string[];
  /** Max file size in bytes. */
  maxFileSize?: number;
}

export const SYSTEM_KEYS = ["id", "slug", "status", "createdAt", "updatedAt"] as const;
export type SystemKey = (typeof SYSTEM_KEYS)[number];

export const UPLOAD_KEYS = ["filename", "mimeType", "filesize", "url", "width", "height"] as const;
export type UploadKey = (typeof UPLOAD_KEYS)[number];

/** Keys of `Fs` whose field is a `text` field. */
export type TextFieldKeys<Fs extends FieldsMap> = {
  [K in keyof Fs]: Fs[K] extends { type: "text" } ? K : never;
}[keyof Fs] &
  string;

export interface CollectionAdminOptions<Fs extends FieldsMap = FieldsMap> {
  useAsTitle?: keyof Fs & string;
  defaultColumns?: readonly ((keyof Fs & string) | SystemKey)[];
  group?: string;
  description?: string;
}

export interface CollectionConfig<
  Slug extends string = string,
  Fs extends FieldsMap = FieldsMap,
  Up extends boolean | UploadOptions = boolean | UploadOptions,
> {
  slug: Slug;
  labels?: { singular?: string; plural?: string };
  fields: Fs;
  /** Text field used to derive `document.slug`. */
  slugFrom?: TextFieldKeys<Fs>;
  /** Draft / publish workflow. Default `true`. */
  drafts?: boolean;
  /** Turns this into an upload (media) collection. */
  upload?: Up;
  admin?: CollectionAdminOptions<Fs>;
  access?: CollectionAccess;
}

/**
 * Any collection, regardless of its generics. Declared structurally (with widened key types)
 * because `CollectionConfig<string, FieldsMap>` collapses key-derived props like `slugFrom` to `never`.
 */
export interface AnyCollection {
  slug: string;
  labels?: { singular?: string; plural?: string };
  fields: FieldsMap;
  slugFrom?: string;
  drafts?: boolean;
  upload?: boolean | UploadOptions;
  admin?: {
    useAsTitle?: string;
    defaultColumns?: readonly string[];
    group?: string;
    description?: string;
  };
  access?: CollectionAccess;
}

/* -------------------------------------------------------------------------- */
/*                                   Config                                   */
/* -------------------------------------------------------------------------- */

export interface XenonAuthConfig {
  /** Secret used by BetterAuth to sign sessions. */
  secret?: string;
  /** Public base URL of the app, e.g. `https://example.com`. */
  baseURL?: string;
  /** Extra origins allowed to call auth endpoints (CSRF protection). */
  trustedOrigins?: readonly string[];
  /** API keys accepted by the REST API (`Authorization: Bearer <key>`). */
  apiKeys?: readonly { key: string; role: XenonRole; name?: string }[];
}

export interface XenonConfigInput<Cs extends readonly AnyCollection[] = readonly AnyCollection[]> {
  collections: Cs;
  db?: DatabaseAdapter;
  storage?: StorageAdapter;
  auth?: XenonAuthConfig;
  admin?: { path?: string };
  api?: { path?: string };
}

export interface XenonConfig<Cs extends readonly AnyCollection[] = readonly AnyCollection[]>
  extends XenonConfigInput<Cs> {
  admin: { path: string };
  api: { path: string };
}

/* -------------------------------------------------------------------------- */
/*                              Inference engine                              */
/* -------------------------------------------------------------------------- */

type SelectOptionValue<O> = O extends string ? O : O extends { value: infer V extends string } ? V : never;

type Many<F, V> = F extends { hasMany: true } ? V[] : V;

/** The value type stored for a single field. */
export type InferFieldValue<F> = F extends { type: "text" | "textarea" }
  ? string
  : F extends { type: "number" }
    ? number
    : F extends { type: "boolean" }
      ? boolean
      : F extends { type: "select"; options: readonly (infer O)[] }
        ? Many<F, SelectOptionValue<O>>
        : F extends { type: "richText" }
          ? RichTextDocument
          : F extends { type: "media" | "relation" }
            ? Many<F, string>
            : never;

type IsRequired<F> = F extends { required: true } ? true : false;
type HasDefault<F> = F extends { defaultValue: infer D } ? (undefined extends D ? false : true) : false;

/** Keys always present (non-null) when reading a document. */
type ReadPresentKeys<Fs> = {
  [K in keyof Fs]: IsRequired<Fs[K]> extends true ? K : HasDefault<Fs[K]> extends true ? K : never;
}[keyof Fs];

/** Keys that must be supplied on create. */
type CreateRequiredKeys<Fs> = {
  [K in keyof Fs]: IsRequired<Fs[K]> extends true
    ? HasDefault<Fs[K]> extends true
      ? never
      : K
    : never;
}[keyof Fs];

export type InferFieldsData<Fs> = Prettify<
  { -readonly [K in ReadPresentKeys<Fs>]: InferFieldValue<Fs[K]> } & {
    -readonly [K in Exclude<keyof Fs, ReadPresentKeys<Fs>>]?: InferFieldValue<Fs[K]> | null;
  }
>;

export type InferFieldsCreateInput<Fs> = Prettify<
  { -readonly [K in CreateRequiredKeys<Fs>]: InferFieldValue<Fs[K]> } & {
    -readonly [K in Exclude<keyof Fs, CreateRequiredKeys<Fs>>]?: IsRequired<Fs[K]> extends true
      ? InferFieldValue<Fs[K]>
      : InferFieldValue<Fs[K]> | null;
  }
>;

/** Metadata managed by the storage layer on upload collections. */
export interface UploadData {
  filename: string;
  mimeType: string;
  filesize: number;
  url: string;
  width?: number | null;
  height?: number | null;
}

export interface SystemFields {
  id: string;
  slug: string | null;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
}

type IsUpload<C> = C extends { upload?: infer U }
  ? [Exclude<U, undefined>] extends [never | false]
    ? false
    : true
  : false;

type FieldsOf<C> = C extends { fields: infer Fs } ? Fs : never;

/** Field values of a collection (plus upload metadata for upload collections). */
export type InferCollectionData<C extends AnyCollection> = Prettify<
  InferFieldsData<FieldsOf<C>> & (IsUpload<C> extends true ? UploadData : {})
>;

/** A full document as returned by the Local / REST API. */
export type InferCollectionType<C extends AnyCollection> = Prettify<
  SystemFields & InferCollectionData<C>
>;

/** Input accepted when creating a document. */
export type InferCreateInput<C extends AnyCollection> = InferFieldsCreateInput<FieldsOf<C>>;

/** Output of draft-mode validation: every field optional and nullable (drafts may be incomplete). */
export type InferDraftInput<C extends AnyCollection> = Prettify<{
  -readonly [K in keyof FieldsOf<C>]?: InferFieldValue<FieldsOf<C>[K]> | null;
}>;

/** Input accepted when updating a document. */
export type InferUpdateInput<C extends AnyCollection> = Prettify<Partial<InferCreateInput<C>>>;

type CollectionsOf<Cfg> = Cfg extends { collections: infer Cs extends readonly AnyCollection[] }
  ? Cs[number]
  : never;

/** Union of collection slugs in a config. */
export type CollectionSlug<Cfg> = CollectionsOf<Cfg>["slug"];

/** The collection definition with slug `S` in a config. */
export type CollectionBySlug<Cfg, S extends CollectionSlug<Cfg>> = Extract<
  CollectionsOf<Cfg>,
  { slug: S }
>;

/** Map of slug → document type for every collection in a config. */
export type InferConfigDocuments<Cfg> = {
  [S in CollectionSlug<Cfg>]: InferCollectionType<CollectionBySlug<Cfg, S>>;
};
