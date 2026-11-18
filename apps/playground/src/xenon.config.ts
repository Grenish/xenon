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

export type Media = InferCollectionType<typeof mediaCollection>;

export default defineConfig({
  collections: [posts, mediaCollection],
  // DATABASE_URL → real Postgres; otherwise an embedded PGlite database in .xenon/ (zero setup).
  db: process.env.DATABASE_URL
    ? postgresAdapter({ connectionString: process.env.DATABASE_URL })
    : postgresAdapter({ pglite: { dataDir: ".xenon/pgdata" } }),
  storage: new LocalStorageAdapter({ directory: ".xenon/uploads" }),
  auth: {
    apiKeys: process.env.XENON_API_KEY ? [{ key: process.env.XENON_API_KEY, role: "editor", name: "playground" }] : [],
  },
});
