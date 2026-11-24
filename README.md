<div align="center">

<img src="xe-logo.svg" width="72" alt="XenonCMS logo" />

# XenonCMS

**A code-first headless CMS for Next.js. Collections are TypeScript, content is typed, and the admin UI ships with your app.**

[![npm: xenon-cms](https://img.shields.io/npm/v/xenon-cms?label=xenon-cms&color=0f766e)](https://www.npmjs.com/package/xenon-cms)
[![npm: create-xenon-app](https://img.shields.io/npm/v/create-xenon-app?label=create-xenon-app&color=0f766e)](https://www.npmjs.com/package/create-xenon-app)
[![npm downloads](https://img.shields.io/npm/dm/xenon-cms?color=0f766e)](https://www.npmjs.com/package/xenon-cms)
[![CI](https://github.com/Grenish/xenon/actions/workflows/ci.yml/badge.svg)](https://github.com/Grenish/xenon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Website](https://xenon.grenishrai.pro) · [Documentation](packages/xenon/README.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

</div>

![The XenonCMS admin dashboard, showing published and draft counts and recently edited posts](.github/assets/admin-dashboard.png)

## Why Xenon

- **Your schema is a TypeScript file.** Fields are plain objects, and document types are inferred from them. There is no codegen step to run after you change a field.
- **No migrations.** Documents are stored as JSONB, so adding or removing a field is a config change. Existing documents keep working, and a new field reads as its default until someone edits them.
- **It runs inside your Next.js app.** Read content from Server Components through the Local API, serve the REST API from a route handler, and mount the admin on a page. One repository, one deploy.
- **Cached pages update on publish.** Every write expires the cache tags for its collection and document, so a cached page refreshes as soon as an editor publishes.
- **Zero setup to start.** Embedded PGlite runs locally with no database server. Switch to any PostgreSQL server or an existing Drizzle database when you deploy.

## Quick start

**New project.** Scaffold a Next.js app with XenonCMS already wired in:

```bash
npm create xenon-app@latest my-site
cd my-site
npm run dev
```

Open <http://localhost:3000/admin> and create the first admin account. The scaffold asks for the database (PGlite or PostgreSQL), the package manager, and whether the app lives in `src/` or at the project root. See the [create-xenon-app README](packages/create-xenon-app/README.md) for every flag.

**Existing Next.js project (16+).** Add Xenon's config, API route and admin page to the project:

```bash
npx xenon-cms init
```

Then start the dev server and open `/admin`. Run `npx xenon-cms init --help` for the options, or add `--dry-run` to see what would change first.

## Example

Define a collection and the database and storage it uses:

```ts
// src/xenon.config.ts
import { defineCollection, defineConfig, relation, richText, select, text } from "xenon-cms";
import type { InferCollectionType } from "xenon-cms";
import { pgliteAdapter } from "xenon-cms/pglite";
import { LocalStorageAdapter } from "xenon-cms/storage/local";

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  admin: { useAsTitle: "title" },
  fields: {
    title: text({ required: true, maxLength: 200 }),
    category: select({ options: ["news", "guide"], required: true }),
    body: richText(),
    related: relation({ relationTo: "posts", hasMany: true }),
  },
});

export type Post = InferCollectionType<typeof posts>;

export default defineConfig({
  collections: [posts],
  db: pgliteAdapter({ dataDir: ".xenon/pgdata" }),
  storage: new LocalStorageAdapter({ directory: ".xenon/uploads" }),
});
```

Query it from a Server Component. The Local API talks to the database directly and returns typed documents:

```ts
import { getXenon } from "xenon-cms/next";
import config from "@/xenon.config";

const { docs } = await getXenon(config).find({
  collection: "posts",
  where: { category: { equals: "guide" } },
  sort: "-createdAt",
  limit: 10,
});
```

The same collection is available over REST at `/api/xenon/posts`. The full API is in the [xenon-cms README](packages/xenon/README.md).

## Features

- Collections with text, textarea, number, boolean, select, rich text (Tiptap), media and relation fields
- Drafts and publishing, with a working copy separate from the published version
- Media uploads to local disk or S3 and Cloudflare R2
- Authentication with BetterAuth: email and password, `admin` and `editor` roles, and API keys for scripts
- Admin UI with a first-run setup, a dashboard, a document editor, a media library and team management
- Team presence: see who is editing, and a soft lock with save-conflict detection
- REST API with filtering, sorting and pagination, plus the Local API for Server Components
- Cache-tag revalidation for Next.js `"use cache"` pages
- Typed field validation with Zod, shared between the server and the admin

## Editing

![The XenonCMS document editor, with a rich text body, excerpt, category and tag fields in the side panel](.github/assets/admin-editor.png)

## Packages

| package | version | what it is |
| --- | --- | --- |
| [`xenon-cms`](packages/xenon) | [![npm](https://img.shields.io/npm/v/xenon-cms?label=)](https://www.npmjs.com/package/xenon-cms) | The CMS: config, Local API, REST handler, admin UI, database and storage adapters |
| [`create-xenon-app`](packages/create-xenon-app) | [![npm](https://img.shields.io/npm/v/create-xenon-app?label=)](https://www.npmjs.com/package/create-xenon-app) | Scaffolder for a new Next.js project with XenonCMS set up |

## Repository layout

| path | what |
| --- | --- |
| [`packages/xenon`](packages/xenon) | the `xenon-cms` package (ESM, built with tsup) |
| [`packages/create-xenon-app`](packages/create-xenon-app) | the `create-xenon-app` scaffolder |
| [`apps/playground`](apps/playground) | a Next.js 16 app that uses `xenon-cms` through the workspace: a blog and the admin |
| [`apps/web`](apps/web) | the project website, xenon.grenishrai.pro |

This is a Bun workspace monorepo.

## Development

You need [Bun](https://bun.sh) (see `.bun-version`) and Node.js 24 for CI parity.

```bash
bun install
bun run build        # build xenon-cms and create-xenon-app
bun run playground   # next dev on http://localhost:3000, with embedded PGlite
```

| command | does |
| --- | --- |
| `bun run build` | build every package in `packages/` |
| `bun run dev` | rebuild `xenon-cms` on change |
| `bun run test` | run every package's tests with `bun test` |
| `bun run typecheck` | `tsc --noEmit` across all workspaces |
| `bun run playground` | start the playground |
| `bun run web` | start the website on http://localhost:3100 |
| `bun run bench` | run the benchmarks (package size, cold start, query latency) |
| `bun run changeset` | describe a change to a published package for the next release |

The playground stores its data under `apps/playground/.xenon/`, which is git-ignored.

To run the database adapter tests against a real PostgreSQL server:

```bash
XENON_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/db bun test packages/xenon/test/adapters/postgres.test.ts
```

## Roadmap

The v1.0 plan is in [ROADMAP.md](ROADMAP.md). Live progress is on the [project board](https://github.com/users/Grenish/projects/5) and in the pinned [v1.0 Roadmap tracker](https://github.com/Grenish/xenon/issues/29).

## Contributing

Bug fixes and small changes can go straight to a pull request. For a new feature or a change to the public API, open an issue first. See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks to run before you push, and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE)
