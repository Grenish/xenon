import { defineCollection, defineConfig, defineGlobal, text, type InferCollectionType } from "../src/index";
import { useLivePreview } from "../src/react/live-preview";
import { createXenon } from "../src/server/xenon";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
    : false;
type Expect<T extends true> = T;

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  admin: {
    previewUrl: (doc) => {
      const title: string = doc.title;
      const slug: string | null = doc.slug;
      // @ts-expect-error unknown field is rejected on typed previewUrl doc
      const nope = doc.doesNotExist;
      void nope;
      return slug ? `/blog/${slug}?t=${encodeURIComponent(title)}` : null;
    },
  },
  fields: {
    title: text({ required: true }),
  },
});

const media = defineCollection({
  slug: "media",
  upload: true,
  admin: {
    previewUrl: (doc) => {
      const filename: string = doc.filename;
      return `/media/${filename}`;
    },
  },
  fields: {
    alt: text(),
  },
});

const site = defineGlobal({
  slug: "site",
  admin: {
    previewUrl: (doc) => {
      const name: string = doc.siteName;
      const slug: "site" = doc.slug;
      // @ts-expect-error unknown field is rejected on typed global previewUrl doc
      const nope = doc.missing;
      void nope;
      return `/${slug}?name=${encodeURIComponent(name)}`;
    },
  },
  fields: {
    siteName: text({ required: true }),
  },
});

const config = defineConfig({
  collections: [posts, media],
  globals: [site],
});

const xenon = createXenon(config);

async function checkSearchTypes() {
  const result = await xenon.find({
    collection: "posts",
    search: "postgres full text",
    limit: 10,
  });
  type DocCheck = Expect<Equal<(typeof result.docs)[number], InferCollectionType<typeof posts>>>;
  const _check: DocCheck = true;
  void _check;

  // @ts-expect-error search must be a string
  await xenon.find({ collection: "posts", search: 42 });
}
void checkSearchTypes;

function checkLivePreviewHook(initial: InferCollectionType<typeof posts>) {
  const { data, isLive } = useLivePreview({ initialData: initial, collection: "posts", id: initial.id });
  type LiveDataCheck = Expect<Equal<typeof data, InferCollectionType<typeof posts>>>;
  type LiveFlagCheck = Expect<Equal<typeof isLive, boolean>>;
  const _a: LiveDataCheck = true;
  const _b: LiveFlagCheck = true;
  void _a;
  void _b;
}
void checkLivePreviewHook;
