/**
 * Core type definitions + the type-level inference engine.
 * Everything here is erased at runtime — no imports with side effects.
 */
import type { DatabaseAdapter, PresenceStore, StorageAdapter, WhereOperators } from "../adapters/types";
import type { AnyCollectionHooks, CollectionHooks, FieldHooks } from "./hooks";

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
  /** Field lifecycle hooks (see `FieldHooks`). Server-only: never sent to the admin client. */
  hooks?: FieldHooks<V>;
}

/**
 * Indexing options for single-value scalar fields (including inside `group` fields,
 * excluding `hasMany: true` and fields inside `array` / `blocks`).
 */
export interface IndexableFieldOptions {
  /** Create a Postgres B-tree expression index for faster range/sort/equality queries. */
  index?: boolean;
  /** Enforce uniqueness across documents in the collection (backed by Postgres partial unique indexes). Implies `index`. */
  unique?: boolean;
}

export interface TextFieldOptions extends BaseFieldOptions<string>, IndexableFieldOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
}

export interface TextareaFieldOptions extends BaseFieldOptions<string> {
  minLength?: number;
  maxLength?: number;
  rows?: number;
}

export interface NumberFieldOptions extends BaseFieldOptions<number>, IndexableFieldOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface BooleanFieldOptions extends BaseFieldOptions<boolean>, IndexableFieldOptions {
  admin?: FieldAdminOptions & {
    /** Control shown in the admin. Default `"switch"`. */
    display?: "switch" | "checkbox";
  };
}

export interface DateFieldOptions extends BaseFieldOptions<string>, IndexableFieldOptions {
  /** Earliest allowed value (ISO-8601, same format as the field). */
  min?: string;
  /** Latest allowed value (ISO-8601, same format as the field). */
  max?: string;
}

export interface EmailFieldOptions extends BaseFieldOptions<string>, IndexableFieldOptions {}

export interface UrlFieldOptions extends BaseFieldOptions<string>, IndexableFieldOptions {
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
  /** Field lifecycle hooks; a container's hook runs after the hooks of its nested fields. */
  hooks?: FieldHooks<V>;
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

export interface SelectFieldOptions extends BaseFieldOptions<string | readonly string[]>, IndexableFieldOptions {
  options: readonly SelectOption[];
  hasMany?: boolean;
}

export interface RichTextFieldOptions extends BaseFieldOptions<RichTextDocument> {}

export interface RelationshipFieldOptions extends BaseFieldOptions<string | readonly string[]>, IndexableFieldOptions {
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
  /** Lifecycle hooks (see `CollectionHooks`). Server-only. */
  hooks?: CollectionHooks<CollectionHookData<Fs, Up>, CollectionHookDoc<Fs, Up>>;
}

/** Field data that collection hooks see for fields `Fs` (plus upload metadata on upload collections). */
export type CollectionHookData<Fs extends FieldsMap, Up> = InferCollectionData<{ slug: string; fields: Fs; upload: Up & (boolean | UploadOptions) }>;
/** A full document as collection hooks see it. */
export type CollectionHookDoc<Fs extends FieldsMap, Up> = Prettify<SystemFields & CollectionHookData<Fs, Up>>;

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
  hooks?: AnyCollectionHooks;
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

/**
 * The collection definition with slug `S` in a config. With an erased config (`XenonConfig`, slugs
 * typed `string`, e.g. the `xenon` handed to hooks) any slug maps to the loose collection type.
 */
export type CollectionBySlug<Cfg, S extends CollectionSlug<Cfg>> = string extends CollectionSlug<Cfg>
  ? CollectionsOf<Cfg>
  : Extract<CollectionsOf<Cfg>, { slug: S }>;

/** Map of slug → document type for every collection in a config. */
export type InferConfigDocuments<Cfg> = {
  [S in CollectionSlug<Cfg>]: InferCollectionType<CollectionBySlug<Cfg, S>>;
};

/* -------------------------------------------------------------------------- */
/*                       Query inference (select/populate)                    */
/* -------------------------------------------------------------------------- */

/** Inclusion projection over a map of fields (`group` fields accept `true` or a nested projection). */
export type SelectFieldsInput<Fs> = {
  readonly [K in keyof Fs]?: Fs[K] extends { type: "group"; fields: infer GFs }
    ? true | SelectFieldsInput<GFs>
    : true;
};

/** Inclusion projection for a collection (`id` is always preserved in the returned document). */
export type SelectInput<C extends AnyCollection> = Prettify<
  { readonly [K in SystemKey]?: true } &
    (IsUpload<C> extends true ? { readonly [K in UploadKey]?: true } : {}) &
    SelectFieldsInput<FieldsOf<C>>
>;

/** Loose runtime shape for `select` (when schema generics are erased). */
export type RuntimeSelect = { readonly [key: string]: true | RuntimeSelect | undefined };

type TargetCollection<Cfg, Target extends string> = Target extends CollectionSlug<Cfg>
  ? CollectionBySlug<Cfg, Target> extends infer C extends AnyCollection
    ? C
    : never
  : never;

type PrevDepth = [never, 0, 1, 2, 3, 4];

type PopulateableKeys<Fs> = {
  [K in keyof Fs]: IsPopulateableField<Fs[K]> extends true ? K : never;
}[keyof Fs];

type IsPopulateableField<F> =
  F extends { type: "relation" | "media" }
    ? true
    : F extends { type: "group" | "array"; fields: infer SubFs }
      ? [PopulateableKeys<SubFs>] extends [never]
        ? false
        : true
      : F extends { type: "blocks"; blocks: readonly (infer B)[] }
        ? [
            B extends { fields: infer BFs }
              ? [PopulateableKeys<BFs>] extends [never]
                ? never
                : true
              : never,
          ] extends [never]
          ? false
          : true
        : false;

type PopulateBranch<Cfg, Target extends string, Depth extends number> =
  TargetCollection<Cfg, Target> extends infer C extends AnyCollection
    ? Depth extends 0
      ? true | { readonly select?: SelectInput<C> }
      :
          | true
          | {
              readonly select?: SelectInput<C>;
              readonly populate?: PopulateFieldsInput<Cfg, FieldsOf<C>, PrevDepth[Depth]>;
            }
    : never;

type PopulateFieldEntry<Cfg, F, Depth extends number> =
  F extends { type: "relation" | "media"; relationTo: infer Target extends string }
    ? PopulateBranch<Cfg, Target, Depth>
    : F extends { type: "group" | "array"; fields: infer SubFs }
      ? PopulateFieldsInput<Cfg, SubFs, Depth>
      : F extends { type: "blocks"; blocks: readonly (infer B)[] }
        ? {
            readonly [Item in B as Item extends { slug: infer BS extends string; fields: infer BFs }
              ? [PopulateableKeys<BFs>] extends [never]
                ? never
                : BS
              : never]?: Item extends { fields: infer BFs } ? PopulateFieldsInput<Cfg, BFs, Depth> : never;
          }
        : never;

/** Explicit typed populate tree over a map of fields (relations, media, and containers holding them). */
export type PopulateFieldsInput<Cfg, Fs, Depth extends number = 4> = {
  readonly [K in PopulateableKeys<Fs>]?: PopulateFieldEntry<Cfg, Fs[K], Depth>;
};

/** Explicit typed populate tree for collection `S` in config `Cfg`. */
export type PopulateInput<Cfg, S extends CollectionSlug<Cfg>, Depth extends number = 4> =
  CollectionBySlug<Cfg, S> extends infer C extends AnyCollection ? PopulateFieldsInput<Cfg, FieldsOf<C>, Depth> : never;

/** Loose runtime shape for `populate` (when schema generics are erased). */
export type RuntimePopulate = { readonly [key: string]: true | RuntimePopulate | { readonly select?: RuntimeSelect; readonly populate?: RuntimePopulate } | undefined };

type ResolvePopulateBranch<Cfg, Target extends string, Entry> =
  TargetCollection<Cfg, Target> extends infer C extends AnyCollection
    ? Entry extends true
      ? InferCollectionType<C>
      : Entry extends { readonly select?: infer SubSel; readonly populate?: infer SubPop }
        ? InferQueryCollectionType<Cfg, C, SubSel, SubPop>
        : InferCollectionType<C>
    : never;

type PopulatedFieldValue<Cfg, F, Entry> =
  F extends { type: "relation" | "media"; relationTo: infer Target extends string }
    ? F extends { hasMany: true }
      ? ResolvePopulateBranch<Cfg, Target, Entry>[]
      : ResolvePopulateBranch<Cfg, Target, Entry> | null
    : F extends { type: "group"; fields: infer SubFs }
      ? PopulatedFieldsData<Cfg, SubFs, Entry>
      : F extends { type: "array"; fields: infer SubFs }
        ? Prettify<{ id: string } & PopulatedFieldsData<Cfg, SubFs, Entry>>[]
        : F extends { type: "blocks"; blocks: readonly (infer B)[] }
          ? (B extends { slug: infer BS extends string; fields: infer BFs }
              ? BS extends keyof Entry
                ? [Exclude<Entry[BS], undefined>] extends [never]
                  ? BlockValue<B, "read">
                  : Prettify<{ blockType: BS; id: string } & PopulatedFieldsData<Cfg, BFs, Exclude<Entry[BS], undefined>>>
                : BlockValue<B, "read">
              : never)[]
          : InferFieldValue<F>;

type FieldValueWithPopulate<Cfg, Fs, K extends keyof Fs, Pop> = K extends keyof Pop
  ? [Exclude<Pop[K], undefined>] extends [never]
    ? InferFieldValue<Fs[K]>
    : PopulatedFieldValue<Cfg, Fs[K], Exclude<Pop[K], undefined>>
  : InferFieldValue<Fs[K]>;

type PopulatedFieldsData<Cfg, Fs, Pop> = [Pop] extends [undefined]
  ? InferFieldsData<Fs>
  : Prettify<
      { -readonly [K in ReadPresentKeys<Fs>]: FieldValueWithPopulate<Cfg, Fs, K, Pop> } & {
        -readonly [K in Exclude<keyof Fs, ReadPresentKeys<Fs>>]?: FieldValueWithPopulate<Cfg, Fs, K, Pop> | null;
      }
    >;

type HasOwnSpec<Obj, K> = K extends keyof Obj
  ? [Exclude<Obj[K], undefined>] extends [never]
    ? false
    : true
  : false;

type KeptKeys<Doc, Sel, Pop, IsRoot extends boolean> = Extract<
  keyof Doc,
  | (IsRoot extends true ? "id" : never)
  | { [K in keyof Doc]: HasOwnSpec<Sel, K> extends true ? K : HasOwnSpec<Pop, K> extends true ? K : never }[keyof Doc]
>;

type RequiredKeptKeys<Doc, Sel, Pop, IsRoot extends boolean> = {
  [K in KeptKeys<Doc, Sel, Pop, IsRoot>]: {} extends Pick<Doc, K> ? never : K;
}[KeptKeys<Doc, Sel, Pop, IsRoot>];

type OptionalKeptKeys<Doc, Sel, Pop, IsRoot extends boolean> = Exclude<
  KeptKeys<Doc, Sel, Pop, IsRoot>,
  RequiredKeptKeys<Doc, Sel, Pop, IsRoot>
>;

type ProjectedPropValue<Doc, K extends keyof Doc, Sel, Pop> = K extends keyof Sel
  ? Exclude<Sel[K], undefined> extends infer S
    ? [S] extends [true]
      ? Doc[K]
      : S extends Record<string, unknown>
        ? NonNullable<Doc[K]> extends Record<string, unknown>
          ? ProjectObject<
              NonNullable<Doc[K]>,
              S,
              K extends keyof Pop ? Exclude<Pop[K], undefined> : undefined,
              false
            >
          : Doc[K]
        : Doc[K]
    : Doc[K]
  : Doc[K];

type ProjectObject<Doc, Sel, Pop, IsRoot extends boolean> = Prettify<
  { -readonly [K in RequiredKeptKeys<Doc, Sel, Pop, IsRoot>]: ProjectedPropValue<Doc, K, Sel, Pop> } & {
    -readonly [K in OptionalKeptKeys<Doc, Sel, Pop, IsRoot>]?: ProjectedPropValue<Doc, K, Sel, Pop>;
  }
>;

/** Exact inferred document type for a read with optional `select` and `populate`. */
export type InferQueryCollectionType<Cfg, C extends AnyCollection, Sel = undefined, Pop = undefined> = [
  Sel,
] extends [undefined]
  ? [Pop] extends [undefined]
    ? InferCollectionType<C>
    : Prettify<SystemFields & PopulatedFieldsData<Cfg, FieldsOf<C>, Pop> & (IsUpload<C> extends true ? UploadData : {})>
  : ProjectObject<
      Prettify<
        SystemFields & PopulatedFieldsData<Cfg, FieldsOf<C>, Pop> & (IsUpload<C> extends true ? UploadData : {})
      >,
      Exclude<Sel, undefined>,
      Pop,
      true
    >;

export type * from "./hooks";
