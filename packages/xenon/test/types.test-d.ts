import {
  boolean,
  defineCollection,
  defineConfig,
  media,
  number,
  relation,
  richText,
  select,
  text,
  textarea,
} from "../src/index";
import type {
  CollectionBySlug,
  CollectionSlug,
  InferCollectionData,
  InferCollectionType,
  InferConfigDocuments,
  InferCreateInput,
  InferDraftInput,
  InferUpdateInput,
  RichTextDocument,
} from "../src/index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
    : false;
type Expect<T extends true> = T;

const matrix = defineCollection({
  slug: "matrix",
  fields: {
    required: text({ required: true }),
    requiredDefault: text({ required: true, defaultValue: "fallback" }),
    optionalDefault: text({ defaultValue: "fallback" }),
    optional: text(),
  },
});

type MatrixRead = Expect<Equal<InferCollectionData<typeof matrix>, {
  required: string;
  requiredDefault: string;
  optionalDefault: string;
  optional?: string | null;
}>>;
type MatrixCreate = Expect<Equal<InferCreateInput<typeof matrix>, {
  required: string;
  requiredDefault?: string;
  optionalDefault?: string | null;
  optional?: string | null;
}>>;
type MatrixUpdate = Expect<Equal<InferUpdateInput<typeof matrix>, {
  required?: string;
  requiredDefault?: string;
  optionalDefault?: string | null;
  optional?: string | null;
}>>;
type MatrixDraft = Expect<Equal<InferDraftInput<typeof matrix>, {
  required?: string | null;
  requiredDefault?: string | null;
  optionalDefault?: string | null;
  optional?: string | null;
}>>;

const createWithDefaults: InferCreateInput<typeof matrix> = { required: "Hello" };
const createWithOptionalNulls: InferCreateInput<typeof matrix> = {
  required: "Hello", optionalDefault: null, optional: null,
};
const emptyUpdate: InferUpdateInput<typeof matrix> = {};
// @ts-expect-error Required fields without defaults must be supplied on create.
const missingRequired: InferCreateInput<typeof matrix> = {};
// @ts-expect-error Required fields reject null even if defaulted.
const nullRequiredDefault: InferCreateInput<typeof matrix> = { required: "Hello", requiredDefault: null };
// @ts-expect-error Required update fields reject null.
const nullRequiredUpdate: InferUpdateInput<typeof matrix> = { required: null };

// No `as const`: helpers must preserve select literals with const generics.
const allFields = defineCollection({
  slug: "posts",
  slugFrom: "title",
  admin: { useAsTitle: "title", defaultColumns: ["title", "status", "id", "slug", "createdAt", "updatedAt"] },
  fields: {
    title: text({ required: true }),
    summary: textarea({ required: true }),
    count: number({ required: true }),
    active: boolean({ required: true }),
    category: select({ options: ["news", "guide"], required: true }),
    labeled: select({ options: [{ label: "News", value: "news" }, { label: "Guide", value: "guide" }], required: true }),
    mixed: select({ options: ["news", { label: "Guide", value: "guide" }], required: true }),
    tags: select({ options: ["one", "two"], hasMany: true, required: true }),
    labeledTags: select({ options: [{ label: "One", value: "one" }, { label: "Two", value: "two" }], hasMany: true, required: true }),
    body: richText({ required: true }),
    cover: media({ relationTo: "media", required: true }),
    gallery: media({ relationTo: "media", hasMany: true, required: true }),
    author: relation({ relationTo: "authors", required: true }),
    related: relation({ relationTo: "posts", hasMany: true, required: true }),
  },
});

type AllFieldValues = {
  title: string;
  summary: string;
  count: number;
  active: boolean;
  category: "news" | "guide";
  labeled: "news" | "guide";
  mixed: "news" | "guide";
  tags: ("one" | "two")[];
  labeledTags: ("one" | "two")[];
  body: RichTextDocument;
  cover: string;
  gallery: string[];
  author: string;
  related: string[];
};

type AllRead = Expect<Equal<InferCollectionData<typeof allFields>, AllFieldValues>>;
type AllCreate = Expect<Equal<InferCreateInput<typeof allFields>, AllFieldValues>>;
type AllUpdate = Expect<Equal<InferUpdateInput<typeof allFields>, Partial<AllFieldValues>>>;
type CategoryLiteral = Expect<Equal<InferCollectionData<typeof allFields>["category"], "news" | "guide">>;
type LabeledLiteral = Expect<Equal<InferCollectionData<typeof allFields>["labeled"], "news" | "guide">>;
type TagsArray = Expect<Equal<InferCollectionData<typeof allFields>["tags"], ("one" | "two")[]>>;
// @ts-expect-error Select values are a literal union, not a general string.
const invalidCategory: InferUpdateInput<typeof allFields> = { category: "other" };
// @ts-expect-error Labeled options use the value, not the display label.
const invalidLabeled: InferUpdateInput<typeof allFields> = { labeled: "News" };
// @ts-expect-error hasMany select inputs must be arrays.
const scalarTags: InferUpdateInput<typeof allFields> = { tags: "one" };
// @ts-expect-error hasMany arrays preserve the option literal union.
const invalidTags: InferUpdateInput<typeof allFields> = { tags: ["three"] };
// @ts-expect-error Media fields contain document ids, not populated objects.
const populatedMedia: InferUpdateInput<typeof allFields> = { cover: { id: "asset-1" } };
// @ts-expect-error hasMany relations contain arrays of document ids.
const scalarRelation: InferUpdateInput<typeof allFields> = { related: "post-1" };

const optionalFields = defineCollection({
  slug: "optional-fields",
  fields: {
    title: text(), summary: textarea(), count: number(), active: boolean(),
    category: select({ options: ["news", "guide"] }),
    tags: select({ options: ["one", "two"], hasMany: true }),
    body: richText(), cover: media({ relationTo: "media" }),
    gallery: media({ relationTo: "media", hasMany: true }),
    author: relation({ relationTo: "authors" }), related: relation({ relationTo: "posts", hasMany: true }),
  },
});
type OptionalFieldValues = {
  title?: string | null;
  summary?: string | null;
  count?: number | null;
  active?: boolean | null;
  category?: "news" | "guide" | null;
  tags?: ("one" | "two")[] | null;
  body?: RichTextDocument | null;
  cover?: string | null;
  gallery?: string[] | null;
  author?: string | null;
  related?: string[] | null;
};
type OptionalRead = Expect<Equal<InferCollectionData<typeof optionalFields>, OptionalFieldValues>>;
type OptionalCreate = Expect<Equal<InferCreateInput<typeof optionalFields>, OptionalFieldValues>>;

const defaultFields = defineCollection({
  slug: "default-fields",
  fields: {
    title: text({ defaultValue: "Hello" }), summary: textarea({ defaultValue: "Summary" }),
    count: number({ defaultValue: 0 }), active: boolean({ defaultValue: false }),
    category: select({ options: ["news", "guide"], defaultValue: "news" }),
    tags: select({ options: ["one", "two"], hasMany: true, defaultValue: ["one"] }),
    body: richText({ defaultValue: { type: "doc", content: [] } }),
    cover: media({ relationTo: "media", defaultValue: "asset-1" }),
    gallery: media({ relationTo: "media", hasMany: true, defaultValue: ["asset-1"] }),
    author: relation({ relationTo: "authors", defaultValue: "author-1" }),
    related: relation({ relationTo: "posts", hasMany: true, defaultValue: [] }),
  },
});
type DefaultRead = Expect<Equal<InferCollectionData<typeof defaultFields>, {
  title: string; summary: string; count: number; active: boolean;
  category: "news" | "guide"; tags: ("one" | "two")[]; body: RichTextDocument;
  cover: string; gallery: string[]; author: string; related: string[];
}>>;
type DefaultCreate = Expect<Equal<InferCreateInput<typeof defaultFields>, OptionalFieldValues>>;

type SystemFields = {
  id: string;
  slug: string | null;
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
};
type FullDocument = Expect<Equal<InferCollectionType<typeof allFields>, {
  [K in keyof (AllFieldValues & SystemFields)]: (AllFieldValues & SystemFields)[K];
}>>;
// @ts-expect-error Full documents require system fields.
const missingSystem: InferCollectionType<typeof matrix> = { required: "Hello", requiredDefault: "Hello", optionalDefault: "Hello" };
// @ts-expect-error System fields are not writable create data.
const createWithId: InferCreateInput<typeof matrix> = { required: "Hello", id: "post-1" };
// @ts-expect-error System fields are not writable update data.
const updateWithStatus: InferUpdateInput<typeof matrix> = { status: "published" };

const uploads = defineCollection({ slug: "media", upload: true, fields: { alt: text({ required: true }), caption: textarea() } });
const configuredUploads = defineCollection({ slug: "images", upload: { mimeTypes: ["image/*"], maxFileSize: 1024 }, fields: {} });
const nonUploads = defineCollection({ slug: "ordinary", upload: false, fields: { title: text() } });
type UploadMetadata = {
  filename: string; mimeType: string; filesize: number; url: string;
  width?: number | null; height?: number | null;
};
type UploadRead = Expect<Equal<InferCollectionData<typeof uploads>, {
  alt: string; caption?: string | null;
  filename: string; mimeType: string; filesize: number; url: string;
  width?: number | null; height?: number | null;
}>>;
type ConfiguredUploadRead = Expect<Equal<InferCollectionData<typeof configuredUploads>, UploadMetadata>>;
type UploadCreate = Expect<Equal<InferCreateInput<typeof uploads>, { alt: string; caption?: string | null }>>;
type UploadUpdate = Expect<Equal<InferUpdateInput<typeof uploads>, { alt?: string; caption?: string | null }>>;
type NonUploadRead = Expect<Equal<InferCollectionData<typeof nonUploads>, { title?: string | null }>>;
type UploadFullDocument = Expect<Equal<Pick<InferCollectionType<typeof uploads>, keyof SystemFields>, SystemFields>>;
// @ts-expect-error Upload metadata is system managed, including filename.
const uploadFilename: InferCreateInput<typeof uploads> = { alt: "A photo", filename: "photo.png" };
// @ts-expect-error Upload metadata is not writable on update.
const uploadWidth: InferUpdateInput<typeof uploads> = { width: 100 };

const config = defineConfig({ collections: [allFields, uploads, nonUploads] });
type Slugs = Expect<Equal<CollectionSlug<typeof config>, "posts" | "media" | "ordinary">>;
type PostsBySlug = Expect<Equal<CollectionBySlug<typeof config, "posts">, typeof allFields>>;
type MediaBySlug = Expect<Equal<CollectionBySlug<typeof config, "media">, typeof uploads>>;
type ConfigDocuments = Expect<Equal<InferConfigDocuments<typeof config>, {
  posts: InferCollectionType<typeof allFields>;
  media: InferCollectionType<typeof uploads>;
  ordinary: InferCollectionType<typeof nonUploads>;
}>>;
// @ts-expect-error CollectionSlug excludes collections not in the config.
const unknownSlug: CollectionSlug<typeof config> = "missing";

defineCollection({ slug: "invalid-slug-from", fields: { title: text() },
  // @ts-expect-error slugFrom must refer to a known field.
  slugFrom: "missing",
});
defineCollection({ slug: "invalid-slug-type", fields: { count: number() },
  // @ts-expect-error slugFrom must refer to a text field.
  slugFrom: "count",
});
defineCollection({ slug: "invalid-title", fields: { title: text() }, admin: {
  // @ts-expect-error useAsTitle must refer to a known field.
  useAsTitle: "missing",
} });
defineCollection({ slug: "invalid-system-title", fields: { title: text() }, admin: {
  // @ts-expect-error useAsTitle does not accept system fields.
  useAsTitle: "status",
} });
defineCollection({ slug: "invalid-columns", fields: { title: text() }, admin: {
  // @ts-expect-error defaultColumns must refer to known fields or system fields.
  defaultColumns: ["missing"],
} });

// @ts-expect-error Select helpers require their options list.
select();
// @ts-expect-error Media helpers require a target collection.
media();
// @ts-expect-error Relation helpers require a target collection.
relation();
// @ts-expect-error Textarea has no pattern option; it is text-only.
textarea({ pattern: /hello/ });
