/**
 * Core type definitions + the type-level inference engine.
 * Everything here is erased at runtime — no imports with side effects.
 */
import type { DatabaseAdapter, PresenceStore, StorageAdapter, WhereOperators } from "../adapters/types";

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
  | "relation"
  | "date"
  | "email"
  | "url"
  | "json"
  | "group"
  | "array"
  | "blocks";

/** Any JSON-serializable value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Minimal [Standard Schema](https://standardschema.dev) v1 interface (Zod, Valibot, ArkType…), used to
 * type and validate `json()` fields. Validation must be synchronous.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) =>
      | { readonly value: Output; readonly issues?: undefined }
      | { readonly issues: readonly { readonly message: string; readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] }[] }
      | Promise<unknown>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

/**
 * Shows a field only when its sibling data matches, e.g. `{ type: { equals: "video" } }`. Keys name
 * sibling fields (the fields next to it in the same collection, group, array row or block); values use
 * the `where` operators (`equals`, `not_equals`, `in`, `not_in`, `contains`, `gt`, `gte`, `lt`, `lte`,
 * `exists`), combinable with `and` / `or`. Plain data, so the admin evaluates it as you type and the
 * server applies the same rule: a hidden field keeps its value but skips `required`, row minimums and
 * custom `validate` (its value's type and format are still checked).
 */
export type FieldCondition = {
  and?: FieldCondition[];
  or?: FieldCondition[];
} & { [field: string]: WhereOperators | FieldCondition[] | undefined };

export interface FieldAdminOptions {
  description?: string;
  hidden?: boolean;
  readOnly?: boolean;
  position?: "main" | "sidebar";
  placeholder?: string;
  /** Show this field only when sibling data matches. See `FieldCondition`. */
  condition?: FieldCondition;
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

export interface BooleanFieldOptions extends BaseFieldOptions<boolean> {
  admin?: FieldAdminOptions & {
    /** Control shown in the admin. Default `"switch"`. */
    display?: "switch" | "checkbox";
  };
}

export interface DateFieldOptions extends BaseFieldOptions<string> {
  /** Earliest allowed value (ISO-8601, same format as the field). */
  min?: string;
  /** Latest allowed value (ISO-8601, same format as the field). */
  max?: string;
}

export interface EmailFieldOptions extends BaseFieldOptions<string> {}

export interface UrlFieldOptions extends BaseFieldOptions<string> {
  /** Allowed URL schemes, without the colon. Default `["http", "https"]`. */
  protocols?: readonly string[];
}

export interface JsonFieldOptions extends BaseFieldOptions<unknown> {
  /** Optional Standard Schema (e.g. a Zod schema) that types and validates the value. */
  schema?: StandardSchemaV1;
}

/** Options shared by `group`, `array` and `blocks`: they hold nested fields, so no `defaultValue` on the container. */
interface ContainerFieldOptions<V> {
  label?: string;
  admin?: FieldAdminOptions;
  validate?: FieldValidateFn<V>;
}

export interface GroupFieldOptions<Fs extends FieldsMap = FieldsMap> extends ContainerFieldOptions<Record<string, unknown>> {
  fields: Fs;
  /** Not supported: a group is required exactly when one of its fields is. */
  required?: never;
  /** Not supported: set defaults on the group's fields. */
  defaultValue?: never;
}

export interface ArrayFieldOptions<Fs extends FieldsMap = FieldsMap> extends ContainerFieldOptions<Record<string, unknown>[]> {
  fields: Fs;
  /** `true` → at least one row. */
  required?: boolean;
  minRows?: number;
  maxRows?: number;
  labels?: { singular?: string; plural?: string };
  defaultValue?: readonly Record<string, unknown>[];
}

/** A block type for `blocks()`, created with `defineBlock()`. */
export interface BlockConfig<Slug extends string = string, Fs extends FieldsMap = FieldsMap> {
  slug: Slug;
  labels?: { singular?: string; plural?: string };
  fields: Fs;
  admin?: { description?: string };
}

/** Any block, regardless of its generics. */
export interface AnyBlock {
  slug: string;
  labels?: { singular?: string; plural?: string };
  fields: FieldsMap;
  admin?: { description?: string };
}

export interface BlocksFieldOptions<Bs extends readonly AnyBlock[] = readonly AnyBlock[]>
  extends ContainerFieldOptions<Record<string, unknown>[]> {
  blocks: Bs;
  /** `true` → at least one block. */
  required?: boolean;
  minRows?: number;
  maxRows?: number;
  defaultValue?: readonly Record<string, unknown>[];
}

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
export type DateField<O extends DateFieldOptions = DateFieldOptions> = {
  readonly type: "date";
  /** `true` (via `datetime()`): a full ISO-8601 timestamp, stored in UTC. Otherwise `YYYY-MM-DD`. */
  readonly time?: boolean;
} & O;
export type EmailField<O extends EmailFieldOptions = EmailFieldOptions> = { readonly type: "email" } & O;
export type UrlField<O extends UrlFieldOptions = UrlFieldOptions> = { readonly type: "url" } & O;
export type JsonField<O extends JsonFieldOptions = JsonFieldOptions> = { readonly type: "json" } & O;
export type GroupField<O extends GroupFieldOptions = GroupFieldOptions> = { readonly type: "group" } & O;
export type ArrayField<O extends ArrayFieldOptions = ArrayFieldOptions> = { readonly type: "array" } & O;
export type BlocksField<O extends BlocksFieldOptions = BlocksFieldOptions> = { readonly type: "blocks" } & O;

export type Field =
  | TextField
  | TextareaField
  | NumberField
  | BooleanField
  | SelectField
  | RichTextField
  | MediaField
  | RelationField
  | DateField
  | EmailField
  | UrlField
  | JsonField
  | GroupField
  | ArrayField
  | BlocksField;

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
  /**
   * Live presence and soft locks in the admin. Default: kept in server memory (no database
   * traffic). `false` turns it off; a custom store shares presence across server instances.
   */
  presence?: PresenceStore | false;
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

/** Which shape of a value to infer: as read, as accepted on create, or as accepted in a draft. */
type InferMode = "read" | "create" | "draft";

type FieldsValue<Fs, M extends InferMode> = M extends "read"
  ? InferFieldsData<Fs>
  : M extends "create"
    ? InferFieldsCreateInput<Fs>
    : InferFieldsDraftInput<Fs>;

/** Rows carry a stable `id` (generated on write when omitted). */
type RowId<M extends InferMode> = M extends "read" ? { id: string } : { id?: string };

type BlockValue<B, M extends InferMode> = B extends { slug: infer S extends string; fields: infer Fs }
  ? Prettify<{ blockType: S } & RowId<M> & FieldsValue<Fs, M>>
  : never;

type SchemaOutput<S> = S extends { readonly "~standard": { readonly types?: infer T } }
  ? NonNullable<T> extends { readonly output: infer O }
    ? O
    : JsonValue
  : JsonValue;

/** The value type stored for a single field (`M`: read shape, create input or draft input). */
export type InferFieldValue<F, M extends InferMode = "read"> = F extends { type: "text" | "textarea" | "email" | "url" | "date" }
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
            : F extends { type: "json" }
              ? F extends { schema: infer S } ? SchemaOutput<S> : JsonValue
              : F extends { type: "group"; fields: infer Fs }
                ? FieldsValue<Fs, M>
                : F extends { type: "array"; fields: infer Fs }
                  ? Prettify<RowId<M> & FieldsValue<Fs, M>>[]
                  : F extends { type: "blocks"; blocks: readonly (infer B)[] }
                    ? BlockValue<B, M>[]
                    : never;

type IsRequired<F> = F extends { required: true } ? true : false;
type HasDefault<F> = F extends { defaultValue: infer D } ? (undefined extends D ? false : true) : false;
/** `group`, `array` and `blocks` always read as a value (`{}` / `[]` when nothing is stored). */
type IsContainer<F> = F extends { type: "group" | "array" | "blocks" } ? true : false;
/** A group must be supplied on create when any of its own fields must be. */
type GroupRequired<F> = F extends { type: "group"; fields: infer Fs }
  ? [CreateRequiredKeys<Fs>] extends [never] ? false : true
  : false;

/** Keys always present (non-null) when reading a document. */
type ReadPresentKeys<Fs> = {
  [K in keyof Fs]: IsRequired<Fs[K]> extends true
    ? K
    : HasDefault<Fs[K]> extends true
      ? K
      : IsContainer<Fs[K]> extends true
        ? K
        : never;
}[keyof Fs];

/** Keys that must be supplied on create. */
type CreateRequiredKeys<Fs> = {
  [K in keyof Fs]: GroupRequired<Fs[K]> extends true
    ? K
    : IsRequired<Fs[K]> extends true
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
  { -readonly [K in CreateRequiredKeys<Fs>]: InferFieldValue<Fs[K], "create"> } & {
    -readonly [K in Exclude<keyof Fs, CreateRequiredKeys<Fs>>]?: IsRequired<Fs[K]> extends true
      ? InferFieldValue<Fs[K], "create">
      : IsContainer<Fs[K]> extends true
        ? InferFieldValue<Fs[K], "create">
        : InferFieldValue<Fs[K], "create"> | null;
  }
>;

/** Draft input: every field optional and nullable (drafts may be incomplete), recursively. */
export type InferFieldsDraftInput<Fs> = Prettify<{
  -readonly [K in keyof Fs]?: InferFieldValue<Fs[K], "draft"> | null;
}>;

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
export type InferDraftInput<C extends AnyCollection> = InferFieldsDraftInput<FieldsOf<C>>;

/** Input accepted when updating a document. */
export type InferUpdateInput<C extends AnyCollection> = Prettify<Partial<InferCreateInput<C>>>;

type CollectionsOf<Cfg> = Cfg extends { collections: infer Cs extends readonly AnyCollection[] }
  ? Cs[number]
  : never;

/** A block value as read (`{ id, blockType, ...fields }`). */
export type InferBlockType<B extends AnyBlock> = BlockValue<B, "read">;

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
