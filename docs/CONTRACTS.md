# XenonCMS — Public API Contract

Owner: coordinator. This is the agreed surface that implementation, tests, and the playground
build against. Proposals for changes go to the coordinator.

Status: §1 frozen (Phase 1, shipped). §2–5 frozen for Phase 2. §6 pending user decisions.

---

## 1. `xenon-cms` (root entry, isomorphic — no Node/Next imports)

### 1.1 Field helpers

Fields are declared as an **object keyed by field name** (not an array). Every helper takes an
optional options object and uses `const` type parameters, so `as const` is never needed.

Common options (all fields):

| option         | type                                   | notes |
|----------------|----------------------------------------|-------|
| `label`        | `string`                               | admin label, defaults to humanized key |
| `required`     | `boolean`                              | literal-typed; drives inference |
| `defaultValue` | value type of the field                | presence drives inference |
| `admin`        | `{ description?: string; hidden?: boolean; readOnly?: boolean; position?: "main" \| "sidebar"; placeholder?: string }` | UI hints |
| `validate`     | `(value, ctx: { data: Record<string, unknown> }) => true \| string` | custom rule; string = error message |

Per field:

| helper       | extra options                                                             | value type (`V`) |
|--------------|---------------------------------------------------------------------------|------------------|
| `text()`     | `minLength?`, `maxLength?`, `pattern?: RegExp`                            | `string` |
| `textarea()` | `minLength?`, `maxLength?`, `rows?`                                        | `string` |
| `number()`   | `min?`, `max?`, `integer?: boolean`                                        | `number` |
| `boolean()`  | —                                                                          | `boolean` |
| `select()`   | `options: readonly (string \| { label: string; value: string })[]` (required), `hasMany?: boolean` | union of option values; `Union[]` if `hasMany` |
| `richText()` | —                                                                          | `RichTextDocument` (Tiptap/ProseMirror JSON: `{ type: "doc"; content?: RichTextNode[] }`) |
| `media()`    | `relationTo: string` (required; must be an **upload** collection), `hasMany?` | `string` (doc id); `string[]` if `hasMany` |
| `relation()` | `relationTo: string` (required; any collection), `hasMany?`              | `string` (doc id); `string[]` if `hasMany` |

Every helper returns a plain serializable-ish object with a `type` discriminant
(`"text" | "textarea" | "number" | "boolean" | "select" | "richText" | "media" | "relation"`)
plus the options as given.

### 1.2 `defineCollection(config)`

```ts
const posts = defineCollection({
  slug: "posts",                       // /^[a-z][a-z0-9-]*$/, unique per config; used in URLs
  labels: { singular: "Post", plural: "Posts" },        // optional
  fields: { title: text({ required: true }), /* ... */ },
  slugFrom: "title",                   // optional; must be a text field key → fills document.slug
  drafts: true,                        // optional (default true): draft/publish workflow
  upload: false,                       // optional; true or { mimeTypes?: string[]; maxFileSize?: number }
  admin: { useAsTitle: "title", defaultColumns: ["title", "status"], group?: string, description?: string },
  access: { read?, create?, update?, delete? },         // (args: { user: XenonUser | null }) => boolean | Promise<boolean>
});
```

- `slugFrom` must be a `text` field key; `admin.useAsTitle` must be a field key; `admin.defaultColumns`
  accepts field keys **and** system keys (`id`, `slug`, `status`, `createdAt`, `updatedAt`). All type-checked.
- Returns the config unchanged at runtime (identity + light validation), preserving literal types.

### 1.3 `defineConfig(config)`

```ts
export default defineConfig({
  collections: [posts, media],        // tuple; slugs become a typed union
  db?: DatabaseAdapter,               // Phase 2
  storage?: StorageAdapter,           // Phase 2
  auth?: XenonAuthConfig,             // Phase 2/3 (BetterAuth)
  admin?: { path?: string },          // default "/admin"
  api?: { path?: string },            // default "/api/xenon"
});
```

Throws `XenonConfigError` (exported) at definition time when:
- two collections share a `slug`, or a slug is invalid;
- a field key is reserved: `id`, `slug`, `status`, `createdAt`, `updatedAt`, or starts with `_`;
- a `relation`/`media` `relationTo` names an unknown collection, or `media` targets a non-upload collection;
- `slugFrom` is not a `text` field key, or `admin.useAsTitle` / `defaultColumns` reference unknown keys;
- a `select` has zero options or duplicate values;
- an upload collection declares a field that collides with upload fields (`filename`, `mimeType`, `filesize`, `url`, `width`, `height`).

The error message names the collection and field path.

### 1.4 Type inference utilities

Rule for a field with value type `V`:

| field declares                          | read type (`InferCollectionData`) | create input (`InferCreateInput`) |
|-----------------------------------------|-----------------------------------|-----------------------------------|
| `required: true`, no `defaultValue`     | `key: V`                          | `key: V`                          |
| `required: true` + `defaultValue`       | `key: V`                          | `key?: V`                         |
| not required + `defaultValue`           | `key: V`                          | `key?: V \| null`                 |
| not required, no `defaultValue`         | `key?: V \| null`                 | `key?: V \| null`                 |

- `InferCollectionData<C>` — field values only (+ upload fields when `upload` is enabled:
  `filename: string; mimeType: string; filesize: number; url: string; width?: number | null; height?: number | null`).
- `InferCollectionType<C>` — a full document: `InferCollectionData<C>` & system fields
  `{ id: string; slug: string | null; status: "draft" | "published"; createdAt: string; updatedAt: string }`.
- `InferCreateInput<C>` — per table above. `InferUpdateInput<C>` — `Partial<InferCreateInput<C>>`.
- `InferDraftInput<C>` — every field `?: V | null` (output of draft-mode validation).
- `CollectionSlug<Config>` — union of slugs in a config. `CollectionBySlug<Config, S>` — that collection's definition.
- `InferConfigDocuments<Config>` — `{ [S in CollectionSlug<Config>]: InferCollectionType<...> }`.

Types are resolved with a `Prettify` so hovers show a flat object.

### 1.5 Runtime validation (Zod v4)

```ts
buildCollectionSchema(collection, { mode: "create" | "update" | "draft" }): z.ZodType
validateCollectionData(collection, input, { mode }):
  | { success: true; data: InferCreateInput<C> | InferUpdateInput<C> | InferDraftInput<C> /* by mode */ }
  | { success: false; issues: { path: (string | number)[]; message: string }[] }
```

- `create`: enforces `required`, applies `defaultValue`s for missing keys.
- `update`: every key optional; provided keys fully validated; no defaults applied.
- `draft`: like `create` but `required` is not enforced: required keys may be omitted **or `null`**
  (clearing a field in a draft is legitimate); defaults applied for missing keys. Non-null values are fully validated.
- `create`/`update`: `null` on a `required` field is rejected — **except** fields with a `defaultValue` (below).
- **Null normalization:** on any field that declares a `defaultValue`, an explicit `null` is replaced by the
  default in **every** mode (create, update, draft). This keeps the read type (`key: V`) truthful.
  Missing keys get defaults in `create`/`draft` only; `update` never adds keys.
- Unknown keys are rejected (strict object). `null` is accepted for non-required fields.
- `text`: min/max length, `pattern`. `textarea`: min/max length only (no `pattern`). `number`: finite, min/max, `integer`.
  `select`: value ∈ options (array + each element for `hasMany`, no duplicates).
  `media`/`relation`: non-empty string id(s). `richText`: object with `type: "doc"`, `content` array of nodes (`{ type: string, ... }`), validated shallowly.
- Field `validate` hooks run after built-in checks; returned string becomes an issue at that path.
- Upload fields on upload collections are system-managed metadata: present in `InferCollectionData`/
  `InferCollectionType`, **absent** from `InferCreateInput`/`InferUpdateInput`, and rejected at runtime in input.

## 2. Adapter contracts (Phase 2 — frozen)

Types: `packages/xenon/src/adapters/types.ts`. Every `DatabaseAdapter` must pass the shared
conformance suite `packages/xenon/test/adapters/conformance.ts`.

### 2.1 DatabaseAdapter semantics

- **Records**: returned `data` / `draftData` are fresh objects (mutating them never affects storage).
  `id` is a UUID string generated by the adapter. `createdAt`/`updatedAt` are `Date`s set by the adapter;
  `update` bumps `updatedAt` **strictly** (at least 1 ms past the previous value), so `updatedAt` is the row's version.
  `update(collection, id, input, { ifUpdatedAt?: Date })`: when given, the write happens only if `updatedAt` still equals
  `ifUpdatedAt` (millisecond precision, same statement); otherwise `UpdateConflictError` (a missing row still returns `null`).
  `(collection, slug)` is unique when `slug` is non-null →
  `SlugConflictError` from `create`/`update`. Collections are fully isolated (same id in another collection = not found).
- **Source** (`FindArgs.source`): `published` → only `status = "published"`, field values from `data`.
  `draft` → all statuses, field values from `draftData ?? data`.
- **Where keys**: system keys `id`, `slug`, `status`, `createdAt`, `updatedAt` (columns; dates compare as ISO strings or `Date`)
  or a top-level field name in the source data. No nested paths. Sibling keys and sibling operators AND;
  `and: Where[]` / `or: Where[]` nest arbitrarily. Empty `where` matches everything.
- **Operators** (on the field's JSON value `x`; "missing" = key absent or `null`):
  - `equals: v` — `x` deep-equals `v` (scalars: strict equality). `equals: null` ⇔ missing.
  - `not_equals: v` — negation of `equals` (so missing values match `not_equals: "a"`).
  - `in: [..]` — `x` equals any element. `not_in` — negation (missing matches).
  - `contains: v` — string `x` & string `v`: case-insensitive substring. Array `x`: some element equals `v`. Otherwise no match.
  - `gt|gte|lt|lte: v` — both numbers: numeric; both strings: binary (code point) comparison; otherwise no match.
  - `exists: true` — not missing; `exists: false` — missing.
- **Sort**: one key, `-` prefix descending, default `-createdAt`. Numbers numeric, strings by Unicode code point (not UTF-16 units / locale), missing values
  **last** in both directions; mixed types unspecified. Ties always broken by `id` ascending (stable pagination).
- **Pagination**: `limit` default 10 (`0` = all), `page` default 1. `totalPages = limit === 0 ? 1 : max(1, ceil(totalDocs / limit))`.
  `hasNextPage = page < totalPages`, `hasPrevPage = page > 1`. Out-of-range page → empty `docs`, correct totals.
- **PGlite data directory lock**: a file-backed `pgliteAdapter({ dataDir })` is guarded by `{dataDir}.lock` (owner pid). A second
  live process gets an error instead of opening it (PGlite is single-process; concurrent use corrupts its WAL); a lock
  whose pid is dead is taken over; `close()` / process exit releases it.
- **getAuthDatabase(authOptions)**: ensures BetterAuth tables (from `getSchema(authOptions)` of `better-auth/db`) exist and
  returns a BetterAuth `database` value. Postgres uses BetterAuth's drizzle adapter; memory uses `better-auth/adapters/memory`.

### 2.4 Postgres adapter entry points (2026-11-19, user decision; replaces the single `xenon-cms/postgres` options union)

Each driver gets its own entry point, and that module imports only its own driver, without bundler-ignore hints.
A consumer installs only the driver it uses: no extra Next config, no direct `drizzle-orm` install, and it works with
npm, pnpm and `output: "standalone"`/serverless file tracing.

| Entry | Export | Options | Needs installed |
|---|---|---|---|
| `xenon-cms/postgres` | `postgresAdapter` | `{ connectionString: string; max?: number }` | `postgres` |
| `xenon-cms/pglite` | `pgliteAdapter` | `{ dataDir?: string }` (omitted = in-memory) | `@electric-sql/pglite` |
| `xenon-cms/drizzle` | `drizzleAdapter` | `{ db: PgDatabase }` (any Drizzle pg database: node-postgres, Neon, …) | neither driver |

- All three return the same `DatabaseAdapter` and share one internal implementation (where, schema, auth DDL), so they all
  pass the conformance suite. `xenonDocuments` stays exported from `xenon-cms/postgres`.
- Both drivers stay optional peers. Importing an entry whose driver isn't installed is a build error naming the driver.
- **PGlite needs one Next.js setting.** `pgliteAdapter` consumers add `serverExternalPackages: ["@electric-sql/pglite"]`
  to `next.config`. Verified with `output: "standalone"` on npm and pnpm (Next 16.4.6, PGlite 0.5.16); no
  `outputFileTracingIncludes` is needed. Without it, Turbopack rewrites PGlite's asset URLs and the database-backed
  prerender fails. `postgresAdapter` and `drizzleAdapter` stay zero-config.
- **PGlite with several statically prerendered DB pages also needs `experimental: { cpus: 1 }`.** Next.js builds with several
  workers, and each worker that opens the same file-backed `dataDir` hits the lock. Verified on a 12-CPU host: with 50
  DB-backed static paths, the default worker count failed with "already open in another process"; `cpus: 1` passed 3/3.
  A single DB-backed page passed either way. Use `cpus: 1` whenever PGlite is read during prerender.
- Since nothing is published yet, the old `postgresAdapter({ pglite })` and `postgresAdapter({ db })` forms are removed, not deprecated.

### 2.3 PresenceStore (admin presence + soft locks, 2026-11-18)

- `config.presence?: PresenceStore | false`. Default: `memoryPresence()` from `xenon-cms/server`, one per process
  (no database traffic). `false` disables the `_presence` route and the admin UI for it.
- `beat({ tab, user, location: { collection, id?, title? } | null, intent: "view" | "edit" | "takeover", version? })`
  → `{ you: { editing, takenOverBy }, peers: PresencePeer[] }`, applied atomically. `edit`: lock granted if no other tab
  holds it; `takeover`: every other holder on that document loses it and gets `takenOverBy`; `view` / moving away
  releases it. Entries are keyed by user + tab and expire after 90 s without a beat. `leave(userId, tab)` drops one.
- Multi-instance deployments need a shared store for a single view (lock semantics must stay atomic).

### 2.2 StorageAdapter semantics

- Classes `LocalStorageAdapter` (`xenon-cms/storage/local`) and `S3StorageAdapter` (`xenon-cms/storage/s3`).
- `new LocalStorageAdapter({ directory?: string = ".xenon/uploads", baseUrl?: string = "/api/xenon/_files" })`:
  writes under `directory` (mkdir -p), `getUrl(key) = baseUrl + "/" + key` (each segment URI-encoded), implements `read`
  (content type from extension; fallback `application/octet-stream`). Rejects unsafe keys (absolute, `..`, backslashes, empty segments).
- `new S3StorageAdapter({ bucket, endpoint, region = "auto", accessKeyId, secretAccessKey, publicUrl, prefix? })`:
  S3 / Cloudflare R2 compatible via `aws4fetch` (path-style `endpoint/bucket/key`). `getUrl = publicUrl + "/" + key`.
  `prefix` applies to both the object path (`{prefix}/{key}`) and the URL (`{publicUrl}/{prefix}/{key}`), with no double slashes.
  Key segments are URI-encoded. Non-2xx responses throw an Error including the status, except DELETE 404 (success). No `read`.
- `delete` of a missing key resolves.

## 3. `xenon-cms/server` — Local API (Phase 2)

```ts
const xenon = createXenon(config, { onChange?: (e: { collection: string; id: string; op: "create" | "update" | "delete" }) => void });
await xenon.init();                     // idempotent; called lazily by every method too
xenon.find({ collection, where?, sort?, limit?, page?, draft?: boolean, user?: XenonUser | null, overrideAccess?: boolean })
  → PaginatedResult<InferCollectionType<C>>
xenon.findById({ collection, id, draft?, user?, overrideAccess? }) → Doc | null
xenon.findBySlug({ collection, slug, draft?, ... }) → Doc | null
xenon.create({ collection, data, draft?: boolean, file?: { data: Uint8Array | Blob; name: string; type: string }, user?, overrideAccess? }) → Doc
xenon.update({ collection, id, data, draft?: boolean, expectedUpdatedAt?: string | Date, user?, overrideAccess? }) → Doc
  // throws NOT_FOUND; with expectedUpdatedAt, CONFLICT (issue path ["updatedAt"]) when the doc was saved since
xenon.unpublish({ collection, id, ... }) → Doc
xenon.delete({ collection, id, ... }) → Doc                                              // deletes stored file for uploads
xenon.auth                              // the BetterAuth instance (null when no db)
```
- `collection` is typed as `CollectionSlug<Config>`, results as that collection's `InferCollectionType`.
- **Drafts** (`collection.drafts !== false`): `create/update` with `draft: true` validate in `draft` mode and write only
  `draftData` (live data untouched; new docs get `status: "draft"`). Without `draft` they validate the merged working copy
  in `create` mode and **publish** it (`data = merged, draftData = null, status = "published"`). `unpublish` moves
  `data` into `draftData` (if no newer draft) and sets `status = "draft"`. When `drafts === false`, `draft` is ignored and
  every write publishes. Reads default to `draft: false` (published only).
- Docs returned = system fields + `defaultValue`s for missing keys + source data. Dates as ISO strings.
- **Slugs**: when `slugFrom` is set, `slug = slugify(value)`; uniqueness by suffix `-2`, `-3`, …; recomputed on each write
  until the doc is first published, then frozen.
- **Uploads**: `file` is required on create for upload collections; the Local API stores it under
  `{collection}/{yyyy}/{mm}/{random}-{safeName}`, fills `filename, mimeType, filesize, url, width, height`
  (images via `image-size`), enforces `upload.mimeTypes` / `maxFileSize`.
- **Access**: `overrideAccess` defaults to `true` in the Local API (server code is trusted). When `false`, collection
  `access.*` functions decide; defaults: `read` = anyone for published reads, a logged-in user for `draft: true`;
  `create/update/delete` = any logged-in user (`admin` or `editor`).
- **Errors**: `XenonError` with `code` `NOT_FOUND | VALIDATION | FORBIDDEN | UNAUTHORIZED | CONFLICT | BAD_REQUEST |
  PAYLOAD_TOO_LARGE | UNSUPPORTED_MEDIA_TYPE`, `status` (HTTP: 404, 400, 403, 401, 409, 400, 413, 415), and
  `issues?: ValidationIssue[]`.

## 4. `xenon-cms/next` (Phase 2)

- `getXenon(config)` → memoized `createXenon` with `onChange` calling `revalidateTag(tag, { expire: 0 })` for
  `xenon`, `xenon:{collection}`, `xenon:{collection}:{id}`. `xenonTags` helper exported for `cacheTag()` use.
- `createApiHandler(config)` → `{ GET, POST, PATCH, DELETE }` for `app/api/xenon/[...slug]/route.ts`:
  - `/{api}/auth/*` → BetterAuth handler.
  - `GET /{api}/_files/{...key}` → `storage.read` (404 if unsupported/missing).
  - `GET /{api}/{collection}` → find. Query: `where[field][op]=v` (qs-style, `in`/`not_in` comma-separated or repeated)
    or `where=<json>`, `sort`, `limit` (max 100), `page`, `draft=true`. Values coerced by field type.
  - `GET /{api}/{collection}/{id}`, `POST /{api}/{collection}` (JSON, or multipart with `file` + `data` JSON for uploads),
    `PATCH /{api}/{collection}/{id}`, `DELETE /{api}/{collection}/{id}`, `POST /{api}/{collection}/{id}/unpublish`.
    `?draft=true` on POST/PATCH saves a draft. `If-Match: "<updatedAt ISO>"` on PATCH → 409 when stale.
  - `POST /{api}/_presence` → presence heartbeat (body `{ token, tab, location, intent, version }` or `{ token, tab, leave: true }`).
    Authenticated by a signed presence token (HMAC of the app secret, 1 h, minted by `AdminPage` and the
    `presence.token` admin action), not by cookies; no database access. 401 on a bad token, 404 when `presence: false`.
  - Auth: BetterAuth session cookie, or `Authorization: Bearer <key>` matching `auth.apiKeys`. Access enforced (`overrideAccess: false`).
  - Responses: JSON documents / paginated results; errors `{ errors: [{ message, path? }] }` with XenonError status.
- Reserved collection slugs: `auth`, `_files` (and any starting with `_`).

## 5. Auth (BetterAuth)

- Tables `xenon_users`, `xenon_sessions`, `xenon_accounts`, `xenon_verifications`, created by `getAuthDatabase`.
- Email + password only; public sign-up **disabled**. Admin plugin with roles `admin` / `editor` (default `editor`).
- First-run bootstrap: when there are zero users, the admin UI offers "create first admin" (server action calling
  `auth.api.createUser` with role `admin`). Afterwards admins create editors from the UI.
- Secret: `auth.secret ?? process.env.XENON_SECRET ?? process.env.BETTER_AUTH_SECRET` (throws in production when missing).

## 6. Admin UI (Phase 3)

**Integration (user app)**
```tsx
// app/admin/[[...segments]]/page.tsx
import "xenon-cms/styles.css";
import config from "@/xenon.config";
import { AdminPage, runAdminAction, type AdminActionInput } from "xenon-cms/next";

async function action(input: AdminActionInput) {
  "use server";
  return runAdminAction(config, input);
}
export default function Page(props: { params: Promise<{ segments?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AdminPage config={config} action={action} {...props} />;
}
```
The single user-land `"use server"` function closes over the module-level `config` import (functions in the config
can't be serialized into a library-defined action). `runAdminAction` re-checks the session on every call.

**Routes** (`adminRoutes` in `src/ui/shared/services.ts`): `/admin`, `/admin/collections/:slug`, `/:slug/new`, `/:slug/:id`,
`/admin/users` (admin role), `/admin/account`, `/admin/login`, `/admin/setup` (only while zero users exist).

**Client contract**: `src/ui/shared/{client-config,services,admin-context}` — `ClientCollection` (JSON-safe config),
`AdminDoc`, `DocSummary`, `AdminServices` (`save/unpublish/remove/search/upload`), `useAdmin()`.
Uploads go through REST multipart (`{api}/{collection}`) to avoid the Server Action body limit.

**Rendering**: `xenon-cms/react` exports `<RichText value components? className? />` and `richTextToPlainText()`
(Server Component friendly, URL-sanitized). `AdminPage` wraps itself in `<Suspense>` (works with `cacheComponents`).

**Bundling**: client components compile into one `"use client"` module (`xenon-cms/client`, internal), imported by
`xenon-cms/next` as an external self-reference. Styles: `xenon-cms/styles.css` (prefix `xe:`, scoped to `.xenon-admin`).

---
Addendum (Phase 2): a missing or `null` value on a declared field that fails validation reports the
message `"This field is required"` (path `[key]`). Upload collections ignore `drafts` (always published).
