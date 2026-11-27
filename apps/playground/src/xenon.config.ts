import {
  array,
  blocks,
  boolean,
  date,
  datetime,
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
} from "xenon-cms";
import type { InferCollectionType } from "xenon-cms";
import { pgliteAdapter } from "xenon-cms/pglite";
import { postgresAdapter } from "xenon-cms/postgres";
import { LocalStorageAdapter } from "xenon-cms/storage/local";

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
  versions: true,
  admin: { useAsTitle: "title", autosave: true },
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

const hero = defineBlock({
  slug: "hero",
  admin: { description: "Large heading with an optional call to action" },
  fields: {
    heading: text({ required: true }),
    subheading: textarea({ rows: 2 }),
    variant: select({ options: ["centered", "split"], defaultValue: "centered" }),
    image: media({ relationTo: "media", admin: { condition: { variant: { equals: "split" } } } }),
    ctaLabel: text(),
    ctaHref: url({ required: true, admin: { condition: { ctaLabel: { exists: true } } } }),
  },
});

const features = defineBlock({
  slug: "features",
  labels: { singular: "Feature grid" },
  admin: { description: "A grid of short feature cards" },
  fields: {
    title: text(),
    items: array({
      labels: { singular: "Feature" },
      maxRows: 6,
      fields: { title: text({ required: true }), description: textarea({ rows: 2 }) },
    }),
  },
});

const quote = defineBlock({
  slug: "quote",
  admin: { description: "A pull quote with attribution" },
  fields: { body: textarea({ required: true }), author: text(), dark: boolean({ admin: { display: "checkbox" } }) },
});

const pages = defineCollection({
  slug: "pages",
  slugFrom: "title",
  admin: { useAsTitle: "title" },
  fields: {
    title: text({ required: true, maxLength: 200 }),
    layout: blocks({ blocks: [hero, features, quote] }),
    seo: group({
      label: "SEO",
      admin: { position: "sidebar" },
      fields: {
        title: text({ maxLength: 60 }),
        description: textarea({ maxLength: 160, rows: 3 }),
        noIndex: boolean({ defaultValue: false }),
      },
    }),
    launchDate: date({ admin: { position: "sidebar" } }),
    publishAt: datetime({ admin: { position: "sidebar" } }),
    contact: email({ admin: { position: "sidebar" } }),
    website: url({ admin: { position: "sidebar" } }),
    meta: json({ admin: { description: "Free-form JSON for integrations" } }),
  },
});

export type Page = InferCollectionType<typeof pages>;

export type Media = InferCollectionType<typeof mediaCollection>;

export default defineConfig({
  collections: [posts, pages, mediaCollection],
  // DATABASE_URL → real Postgres; otherwise an embedded PGlite database in .xenon/ (zero setup).
  db: process.env.DATABASE_URL
    ? postgresAdapter({ connectionString: process.env.DATABASE_URL })
    : pgliteAdapter({ dataDir: ".xenon/pgdata" }),
  storage: new LocalStorageAdapter({ directory: ".xenon/uploads" }),
  auth: {
    apiKeys: process.env.XENON_API_KEY ? [{ key: process.env.XENON_API_KEY, role: "editor", name: "playground" }] : [],
  },
});
