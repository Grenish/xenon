import {
  array,
  blocks,
  boolean,
  date,
  defineBlock,
  defineCollection,
  defineConfig,
  email,
  group,
  json,
  media,
  number,
  relation,
  richText,
  select,
  text,
  textarea,
  url,
} from "../src/index";
import type { InferCollectionType } from "../src/index";
import { createXenon } from "../src/server";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
    : false;
type Expect<T extends true> = T;

const mediaColl = defineCollection({
  slug: "media",
  upload: true,
  fields: {
    alt: text({ required: true }),
    caption: textarea(),
  },
});

const authors = defineCollection({
  slug: "authors",
  fields: {
    name: text({ required: true, index: true }),
    email: email({ required: true, unique: true }),
    avatar: media({ relationTo: "media" }),
    homepage: url({ index: true }),
    joinedOn: date({ index: true }),
  },
});

const hero = defineBlock({
  slug: "hero",
  fields: {
    heading: text({ required: true }),
    image: media({ relationTo: "media" }),
  },
});

const quote = defineBlock({
  slug: "quote",
  fields: {
    body: textarea({ required: true }),
  },
});

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  fields: {
    title: text({ required: true, index: true }),
    sku: text({ unique: true }),
    count: number({ index: true }),
    featured: boolean({ defaultValue: false, index: true }),
    category: select({ options: ["news", "guide"], index: true }),
    body: richText(),
    author: relation({ relationTo: "authors", required: true, index: true }),
    cover: media({ relationTo: "media" }),
    related: relation({ relationTo: "posts", hasMany: true }),
    seo: group({
      fields: {
        title: text(),
        noIndex: boolean({ defaultValue: false, index: true }),
        ogImage: media({ relationTo: "media" }),
      },
    }),
    gallery: array({
      fields: {
        caption: text(),
        asset: media({ relationTo: "media", required: true }),
      },
    }),
    layout: blocks({ blocks: [hero, quote] }),
    meta: json(),
  },
});

const config = defineConfig({ collections: [mediaColl, authors, posts] });
const xenon = createXenon(config);

type MediaDoc = InferCollectionType<typeof mediaColl>;
type AuthorDoc = InferCollectionType<typeof authors>;
type PostDoc = InferCollectionType<typeof posts>;

// 1. Plain reads without select/populate preserve exact DocOf<Cfg, S>.
async function plainRead() {
  const res = await xenon.find({ collection: "posts" });
  const one = await xenon.findById({ collection: "posts", id: "1" });
  const bySlug = await xenon.findBySlug({ collection: "posts", slug: "hello" });
  type T1 = Expect<Equal<typeof res.docs[number], PostDoc>>;
  type T2 = Expect<Equal<typeof one, PostDoc | null>>;
  type T3 = Expect<Equal<typeof bySlug, PostDoc | null>>;
  return [res, one, bySlug] as unknown as [T1, T2, T3];
}

// 2. Select projection (root fields, system keys, nested group) always preserves `id`.
async function selectRead() {
  const res = await xenon.find({
    collection: "posts",
    select: { title: true, slug: true, count: true, seo: { noIndex: true } },
  });
  type Doc = typeof res.docs[number];
  type TSelect = Expect<Equal<Doc, {
    id: string;
    slug: string | null;
    title: string;
    seo: { noIndex: boolean };
    count?: number | null;
  }>>;

  const mediaRes = await xenon.findById({
    collection: "media",
    id: "m1",
    select: { url: true, alt: true, width: true },
  });
  type TMediaSelect = Expect<Equal<typeof mediaRes, {
    id: string;
    alt: string;
    url: string;
    width?: number | null;
  } | null>>;

  return [res, mediaRes] as unknown as [TSelect, TMediaSelect];
}

// 3. Explicit populate (single, optional media, hasMany self-referential, nested populate + select).
async function populateRead() {
  const res = await xenon.find({
    collection: "posts",
    populate: {
      author: { populate: { avatar: { select: { url: true, alt: true } } }, select: { name: true } },
      cover: true,
      related: { select: { title: true } },
    },
  });
  type Doc = typeof res.docs[number];
  type TAuthor = Expect<Equal<Doc["author"], {
    id: string;
    name: string;
    avatar?: { id: string; alt: string; url: string } | null;
  } | null>>;
  type TCover = Expect<Equal<Doc["cover"], MediaDoc | null | undefined>>;
  type TRelated = Expect<Equal<Doc["related"], { id: string; title: string }[] | null | undefined>>;
  // Unpopulated fields stay untouched.
  type TTitle = Expect<Equal<Doc["title"], string>>;
  return res as unknown as [TAuthor, TCover, TRelated, TTitle];
}

// 4. Populate inside group, array, and blocks (discriminated union preserves untouched blocks).
async function compositePopulateRead() {
  const doc = await xenon.findBySlug({
    collection: "posts",
    slug: "hello",
    select: { title: true, seo: { noIndex: true } },
    populate: {
      seo: { ogImage: { select: { url: true } } },
      gallery: { asset: { select: { url: true } } },
      layout: { hero: { image: { select: { url: true, alt: true } } } },
    },
  });
  type D = NonNullable<typeof doc>;
  type TSeo = Expect<Equal<D["seo"], { noIndex: boolean; ogImage?: { id: string; url: string } | null }>>;
  type TGallery = Expect<Equal<D["gallery"], { id: string; asset: { id: string; url: string } | null; caption?: string | null }[]>>;
  type TLayout = Expect<Equal<
    D["layout"],
    (
      | { blockType: "hero"; id: string; heading: string; image?: { id: string; alt: string; url: string } | null }
      | { blockType: "quote"; id: string; body: string }
    )[]
  >>;
  return doc as unknown as [TSeo, TGallery, TLayout];
}

// 5. Combined root select + populate keeps populated fields even when omitted from select.
async function selectAndPopulateCombined() {
  const doc = await xenon.findById({
    collection: "posts",
    id: "p1",
    select: { title: true },
    populate: { author: true },
  });
  type TCombined = Expect<Equal<typeof doc, { id: string; title: string; author: AuthorDoc | null } | null>>;
  return doc as unknown as TCombined;
}

// 6. Compile-time negative checks (@ts-expect-error).
async function invalidUsages() {
  // @ts-expect-error — unknown field in select
  await xenon.find({ collection: "posts", select: { nope: true } });
  // @ts-expect-error — false is not allowed in select (inclusion-only)
  await xenon.find({ collection: "posts", select: { title: false } });
  // @ts-expect-error — cannot nest select under non-group field
  await xenon.find({ collection: "posts", select: { title: { sub: true } } });
  // @ts-expect-error — cannot populate a plain text field
  await xenon.find({ collection: "posts", populate: { title: true } });
  // @ts-expect-error — quote block has no relation/media fields
  await xenon.find({ collection: "posts", populate: { layout: { quote: { body: true } } } });
  // @ts-expect-error — unknown field in nested target select
  await xenon.find({ collection: "posts", populate: { author: { select: { missing: true } } } });
  // @ts-expect-error — index/unique not allowed on textarea / richText / json
  textarea({ index: true });
  // @ts-expect-error — index/unique not allowed on richText
  richText({ unique: true });
  // @ts-expect-error — index/unique not allowed on json
  json({ index: true });
}

export { plainRead, selectRead, populateRead, compositePopulateRead, selectAndPopulateCombined, invalidUsages };
