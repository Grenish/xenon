# xenon-cms

A lightweight, code-first headless CMS that lives inside your Next.js app.

- **Code-first schema.** Collections and fields are TypeScript; document types are inferred from them.
- **Next.js native.** A Local API for Server Components, a REST handler, and an admin UI mounted as one page.
- **Postgres storage.** Any Postgres server, or embedded PGlite with zero setup for local development.
- **Drafts and publishing**, media uploads (local disk or S3/R2), rich text (Tiptap), roles (admin / editor).
- **Cache-aware.** Publishing expires the right `cacheTag`s, so cached pages update immediately.

Requires Next.js 16+ and React 19+. ESM only.

## Install

```bash
bun add xenon-cms          # or npm / pnpm / yarn

# plus one database driver
bun add postgres               # a PostgreSQL server
bun add @electric-sql/pglite   # embedded Postgres (local dev, tests)
```

## 1. Define your content

```ts
// src/xenon.config.ts
import { defineCollection, defineConfig, media, relation, richText, select, text, textarea } from "xenon-cms";
import type { InferCollectionType } from "xenon-cms";
import { pgliteAdapter } from "xenon-cms/pglite";
import { LocalStorageAdapter } from "xenon-cms/storage/local";

const images = defineCollection({
  slug: "media",
  upload: true, // or { mimeTypes: ["image/*"], maxFileSize: 5_000_000 }
  fields: { alt: text({ required: true }), caption: textarea() },
});

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title", // fills document.slug
  admin: { useAsTitle: "title" },
  fields: {
    title: text({ required: true, maxLength: 200 }),
    category: select({ options: ["news", "guide"], required: true }),
    body: richText(),
    cover: media({ relationTo: "media" }),
    related: relation({ relationTo: "posts", hasMany: true }),
  },
});

export type Post = InferCollectionType<typeof posts>;

export default defineConfig({
  collections: [posts, images],
  db: pgliteAdapter({ dataDir: ".xenon/pgdata" }),
  storage: new LocalStorageAdapter({ directory: ".xenon/uploads" }),
});
```

### Fields

Fields are an object keyed by field name. Every field accepts `label`, `required`, `defaultValue`,
`validate(value, { data })` (return `true` or an error message) and
`admin: { description, placeholder, hidden, readOnly, position: "main" | "sidebar" }`.

| helper | extra options | value |
| --- | --- | --- |
| `text()` | `minLength`, `maxLength`, `pattern` | `string` |
| `textarea()` | `minLength`, `maxLength`, `rows` | `string` |
| `number()` | `min`, `max`, `integer` | `number` |
| `boolean()` | | `boolean` |
| `select()` | `options` (required), `hasMany` | union of option values, or an array of them |
| `richText()` | | Tiptap / ProseMirror JSON |
| `media()` | `relationTo` (an upload collection), `hasMany` | document id(s) |
| `relation()` | `relationTo`, `hasMany` | document id(s) |

Reserved field names: `id`, `slug`, `status`, `createdAt`, `updatedAt`, and anything starting with `_`.
Upload collections also manage `filename`, `mimeType`, `filesize`, `url`, `width`, `height`.

### Collections

```ts
defineCollection({
  slug: "posts",                                  // lowercase, used in URLs
  labels: { singular: "Post", plural: "Posts" }, // optional
  fields: { /* … */ },
  slugFrom: "title",                              // optional, a text field
  drafts: true,                                   // default true; false = every save publishes
  upload: false,                                  // true or { mimeTypes, maxFileSize }
  admin: { useAsTitle: "title", defaultColumns: ["title", "status"], group: "Content", description: "…" },
  access: { read, create, update, delete },       // ({ user }) => boolean | Promise<boolean>
});
```

`defineConfig` throws a `XenonConfigError` naming the collection and field when the schema is
inconsistent (duplicate slugs, unknown `relationTo`, reserved field names, and so on).

### Types

`InferCollectionType<C>` is a full document (fields plus `id`, `slug`, `status`, `createdAt`,
`updatedAt`). Also exported: `InferCollectionData`, `InferCreateInput`, `InferUpdateInput`,
`InferDraftInput`, `CollectionSlug<Config>`, `InferConfigDocuments<Config>`.

`validateCollectionData(collection, input, { mode: "create" | "update" | "draft" })` and
`buildCollectionSchema` expose the same Zod validation the CMS uses.

## 2. Database and storage

Choose the entry point for your database. For a PostgreSQL server, install `postgres`:

```ts
import { postgresAdapter } from "xenon-cms/postgres";

const db = postgresAdapter({ connectionString: process.env.DATABASE_URL!, max: 10 });
```

For embedded Postgres, install `@electric-sql/pglite`:

```ts
import { pgliteAdapter } from "xenon-cms/pglite";

const db = pgliteAdapter({ dataDir: ".xenon/pgdata" }); // omit options for an in-memory database
```

If your app already has a Drizzle PostgreSQL database, pass it directly. Your app owns its connection and closes it when finished.

```ts
import { drizzleAdapter } from "xenon-cms/drizzle";
import { db } from "./db";

const adapter = drizzleAdapter({ db });
```

Tables (`xenon_documents` plus the auth tables) are created on first use; there are no migrations to
run when you add fields.
`memoryAdapter()` from `xenon-cms/memory` is available for tests.

```ts
import { LocalStorageAdapter } from "xenon-cms/storage/local";
import { S3StorageAdapter } from "xenon-cms/storage/s3";

new LocalStorageAdapter({ directory: ".xenon/uploads" }); // served by the REST handler at /api/xenon/_files/…
new S3StorageAdapter({                                    // S3 and Cloudflare R2
  bucket: "my-bucket",
  endpoint: "https://<account>.r2.cloudflarestorage.com",
  region: "auto",
  accessKeyId: process.env.S3_KEY!,
  secretAccessKey: process.env.S3_SECRET!,
  publicUrl: "https://cdn.example.com",
  prefix: "uploads", // optional
});
```

> **PGlite is single-process.** Only one process may open a PGlite folder at a time; Xenon enforces
> this with a `{dataDir}.lock` file and a clear error. `next build` prerenders in several worker
> processes, so with PGlite build with one worker (`experimental: { cpus: 1 }` in `next.config.ts`),
> and don't run a build while `next dev` is using the same folder. Use `postgresAdapter({ connectionString })` with a PostgreSQL server for multi-process deployments.

## 3. Mount the REST API

```ts
// src/app/api/xenon/[...slug]/route.ts
import config from "@/xenon.config";
import { createApiHandler } from "xenon-cms/next";

export const { GET, POST, PATCH, DELETE } = createApiHandler(config);
```

| request | does |
| --- | --- |
| `GET /api/xenon/{collection}` | list: `where[field][op]=value` or `where=<json>`, `sort`, `limit` (max 100), `page`, `draft=true` |
| `GET /api/xenon/{collection}/{id}` | one document (`?draft=true` for the working copy) |
| `POST /api/xenon/{collection}` | create (JSON, or multipart `file` + `data` for uploads) |
| `PATCH /api/xenon/{collection}/{id}` | update |
| `POST /api/xenon/{collection}/{id}/unpublish` | unpublish |
| `DELETE /api/xenon/{collection}/{id}` | delete |
| `/api/xenon/auth/*` | BetterAuth endpoints |
| `GET /api/xenon/_files/{key}` | files stored by `LocalStorageAdapter` |

`?draft=true` on `POST`/`PATCH` saves a draft instead of publishing. Send
`If-Match: "<updatedAt>"` with a `PATCH` to refuse the write (409) when someone saved in between. Where operators: `equals`,
`not_equals`, `in`, `not_in`, `contains`, `gt`, `gte`, `lt`, `lte`, `exists`, combined with `and` / `or`.
Published documents are readable by anyone by default; drafts and writes need a signed-in session
or an API key (`Authorization: Bearer <key>`). Errors come back as `{ errors: [{ message, path? }] }`.

## 4. Mount the admin

```tsx
// src/app/admin/[[...segments]]/page.tsx
import "xenon-cms/styles.css";
import config from "@/xenon.config";
import { AdminPage, runAdminAction, type AdminActionInput, type AdminPageProps } from "xenon-cms/next";

export const metadata = { title: "Admin" };

async function action(input: AdminActionInput) {
  "use server";
  return runAdminAction(config, input);
}

export default function Page(props: Pick<AdminPageProps, "params" | "searchParams">) {
  return <AdminPage config={config} action={action} {...props} />;
}
```

The `"use server"` function has to live in your app: it closes over your config, which contains
functions that can't be passed to a library-defined action. `runAdminAction` re-checks the session
on every call.

Open `/admin`. On first run it asks you to create the first admin; after that, admins add editors
from **Team**. Editors can manage content but not users.

The admin's styles are prefixed (`xe:`) and scoped to a `.xenon-admin` root, so they don't collide
with your site's CSS. Change the paths with `admin: { path }` and `api: { path }` in `defineConfig`.

### Team presence

When several people work in the admin, each one sees who is online and where, avatars on the
documents others have open, and a soft lock: the first person to open a document edits it, others
see it read-only (with the editor's saves appearing live) and can **Take over**. Every save also
carries the version it was based on, so a stale save is never silently overwritten: you choose to
keep yours or load theirs.

Presence costs no database work: tabs send a small heartbeat with a signed token and the server
keeps presence in memory. On a single server (`next start`, a container) that's all you need. If
your app runs on several instances at once, pass a shared `presence` store, or turn it off with
`presence: false` (the save-conflict check works either way).

```ts
// next.config.ts
const nextConfig = {
  cacheComponents: true,                            // for "use cache" + cacheTag (section 6)
};
```

## 5. Auth

Auth is [BetterAuth](https://www.better-auth.com): email and password, no public sign-up, roles
`admin` and `editor`.

| env var | purpose |
| --- | --- |
| `XENON_SECRET` | Signs sessions. **Required in production** (`openssl rand -base64 32`). `BETTER_AUTH_SECRET` also works. |
| `XENON_URL` | Public base URL of the app, e.g. `https://example.com`. `BETTER_AUTH_URL` also works. |
| `DATABASE_URL` | Not read by Xenon itself; pass it to `postgresAdapter` as shown above. |

The same values can be set in code, along with API keys for scripts and other servers:

```ts
defineConfig({
  // …
  auth: {
    secret: process.env.XENON_SECRET,
    baseURL: process.env.XENON_URL,
    trustedOrigins: ["https://preview.example.com"],
    apiKeys: [{ key: process.env.XENON_API_KEY!, role: "editor", name: "import script" }],
  },
});
```

```bash
curl -H "Authorization: Bearer $XENON_API_KEY" "https://example.com/api/xenon/posts?draft=true"
```

## 6. Read content in your app (Local API)

`getXenon(config)` returns a typed, memoized Local API. It talks to the database directly; no HTTP.

```ts
import { getXenon } from "xenon-cms/next";
import config from "@/xenon.config";

const xenon = getXenon(config);

const { docs, totalDocs, hasNextPage } = await xenon.find({
  collection: "posts",
  where: { category: { equals: "guide" } },
  sort: "-createdAt",
  limit: 10,
});
const post = await xenon.findBySlug({ collection: "posts", slug: "hello" });
const same = await xenon.findById({ collection: "posts", id: post!.id, draft: true }); // working copy

await xenon.create({ collection: "posts", data: { title: "Hi", category: "news" }, draft: true });
await xenon.update({ collection: "posts", id, data: { title: "Hello" } }); // publishes
await xenon.unpublish({ collection: "posts", id });
await xenon.delete({ collection: "posts", id });
```

- Reads return published documents unless you pass `draft: true`.
- `create` / `update` publish unless you pass `draft: true`, which only writes the working copy.
- The Local API is trusted server code: collection `access` rules are skipped unless you pass
  `overrideAccess: false` together with a `user`.
- Failures throw `XenonError` (`code`: `NOT_FOUND`, `VALIDATION`, `FORBIDDEN`, `UNAUTHORIZED`,
  `CONFLICT`, `BAD_REQUEST`; plus `status` and `issues`).

Outside Next.js (scripts, tests), use `createXenon(config)` from `xenon-cms/server`.

### Caching

Every write through `getXenon` (admin, REST, or your own code) expires three tags: `xenon`,
`xenon:{collection}` and `xenon:{collection}:{id}`. Tag your cached reads with the `xenonTags`
helper and they update as soon as an editor publishes. This needs `cacheComponents: true`.

```ts
import { cacheLife, cacheTag } from "next/cache";
import { getXenon, xenonTags } from "xenon-cms/next";
import config, { type Post } from "@/xenon.config";

export async function getPublishedPosts() {
  "use cache";
  cacheTag(xenonTags.collection("posts")); // also: xenonTags.all, xenonTags.doc("posts", id)
  cacheLife("max");
  const { docs } = await getXenon(config).find({ collection: "posts", sort: "-createdAt", limit: 20 });
  return docs as Post[];
}
```

## 7. Render rich text

```tsx
import { RichText, richTextToPlainText } from "xenon-cms/react";

<RichText value={post.body} className="prose" />

// override how a node type renders
<RichText
  value={post.body}
  components={{ image: ({ node }) => <img src={String(node.attrs?.src)} alt={String(node.attrs?.alt ?? "")} loading="lazy" /> }}
/>

const excerpt = richTextToPlainText(post.body).slice(0, 160);
```

`RichText` works in Server Components, has no client JavaScript, and only emits `http(s)`, `mailto`,
`tel` and relative URLs.

## Entry points

| import | contents |
| --- | --- |
| `xenon-cms` | `defineConfig`, `defineCollection`, field helpers, types, validation (isomorphic) |
| `xenon-cms/next` | `getXenon`, `xenonTags`, `createApiHandler`, `AdminPage`, `runAdminAction` |
| `xenon-cms/server` | `createXenon`, `XenonError`, auth helpers (no Next.js dependency) |
| `xenon-cms/react` | `RichText`, `richTextToPlainText` |
| `xenon-cms/postgres`, `xenon-cms/pglite`, `xenon-cms/drizzle`, `xenon-cms/memory` | database adapters |
| `xenon-cms/storage/local`, `xenon-cms/storage/s3` | storage adapters |
| `xenon-cms/styles.css` | admin styles |

## License

MIT
