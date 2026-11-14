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
} from "xenon-cms";
import type { InferCollectionType } from "xenon-cms";

const mediaCollection = defineCollection({
  slug: "media",
  upload: true,
  fields: {
    alt: text({ required: true }),
    caption: textarea(),
  },
});

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  admin: { useAsTitle: "title" },
  fields: {
    title: text({ required: true, maxLength: 200 }),
    excerpt: textarea(),
    category: select({ options: ["news", "guide", "release"], required: true }),
    tags: select({ options: ["typescript", "nextjs", "cms"], hasMany: true }),
    featured: boolean({ defaultValue: false }),
    readingTime: number({ integer: true, min: 0 }),
    body: richText(),
    cover: media({ relationTo: "media" }),
    related: relation({ relationTo: "posts", hasMany: true }),
  },
});

export type Post = InferCollectionType<typeof posts>;

export default defineConfig({ collections: [posts, mediaCollection] });
