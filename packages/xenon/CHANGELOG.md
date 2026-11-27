# xenon-cms

## 0.4.0

### Minor Changes

- 89a6472: Admin editorial tools (#18): trash, duplicate, bulk actions, list filters, saved views and a column chooser.
  
  - **Trash.** `defineCollection({ trash: true })` turns `delete` into a soft delete. The document leaves the site, stops appearing in reads (relations to it populate as `null`), and keeps its slug so it can be restored without collisions. New Local API methods: `restore` (returns it from the trash; `afterChange` runs with `operation: "restore"`) and `purge` (deletes for good, with its stored file and versions). `find({ trash: true })` lists the trash, and `findById({ trash: true })` reads a trashed document. Delete hooks get `permanent: boolean`. They run when a document leaves the site, and don't run again when a trashed one is purged. Trashing clears pending schedules. REST: `GET {c}?trash=true`, `POST {c}/{id}/restore`, `DELETE {c}/{id}?permanent=true`. The Postgres and PGlite adapters add a `deleted_at` column in place, and `FindArgs.trash` (`exclude` by default, or `include` / `only`) lets adapters scope reads.
  - **Duplicate.** `duplicate({ collection, id, data? })` copies a document's working copy into a new draft through `create`. Values of `unique` fields are left out and the slug is generated afresh. `data` overrides values on the copy. REST: `POST {c}/{id}/duplicate`. In the admin, Duplicate is in the editor's menu and names the copy "… (copy)".
  - **Bulk actions.** In the admin list, select rows to publish, unpublish, move to the trash or delete. In the Trash view, select rows to restore or delete permanently. Each document runs through the full write path, and failures are reported one by one.
  - **List filters and views.** A filter bar combines conditions per field type (contains, is, is not, after/before, greater/less, is set/empty). Filters are kept in the URL (`?filter=`), so a filtered list can be shared as a link. Saved views store filters, sorting and columns per browser. A column chooser picks which fields the table shows.
- 8027034: Add framework-agnostic Live Preview (#14) and PostgreSQL `tsvector` full-text search (#17).
  
  ### Live Preview (#14)
  - Added `admin.previewUrl(doc)` to `defineCollection` and `defineGlobal` with full document/global type inference and config validation.
  - Added signed preview HTTP endpoints (`POST /{api}/_preview`, `GET /{api}/_preview?token=...`, `GET`/`POST /{api}/_preview/exit`) with HMAC-SHA256 tokens, HttpOnly `xenon-preview` session cookies, access-control enforcement, and open-redirect protection against trusted origins.
  - Added framework-agnostic request verification (`verifyPreviewRequest`, `isPreviewRequest`, `readPreviewCookie`) on `xenon-cms/server` and `xenon-cms/http`, plus Next.js App Router `draftMode()` integration via `createApiHandler`, `createPreviewHandler`, and `isDraftPreview` on `xenon-cms/next`.
  - Added client live-update protocol (`subscribeLivePreview`, `mergeLivePreviewData`) on `xenon-cms` and `xenon-cms/react`, and the `"use client"` `useLivePreview` hook on `xenon-cms/live-preview`.
  - Added a split-pane Live Preview panel with Desktop/Tablet/Mobile viewport presets and debounced unsaved-state `postMessage` syncing to `DocumentEditor` and `GlobalEditor`.
  
  ### Full-text search (#17)
  - Added `search?: string` to `xenon.find()`, `DatabaseAdapter.find()`, and `GET /{api}/{collection}?search=...`, with relevance ranking (`ts_rank`) when no explicit `sort` is specified.
  - Added dual `search_vector` (live published data) and `draft_search_vector` (pending draft data) `tsvector` columns with GIN indexes on `xenon_documents` so published searches never leak unpublished draft text while draft/admin searches match working copies.
  - Implemented matching full-text search (prefix tokens, quoted phrases, `OR`, `-negation`, relevance ranking) in `memoryAdapter` and `DatabaseAdapter` conformance tests.
  - Upgraded admin collection search (`?q=...`) and `doc.search` (`⌘K` / relation pickers) to use full-text search across text, textarea, select, rich-text bodies, nested containers, slugs, and upload filenames.
- 471f4c4: Version history with draft autosave (#15) and scheduled publishing (#16):
  
  - **Versions.** `defineCollection({ versions: true | { max } })` keeps a copy of a document on every publish, manual draft save and restore (the newest 50 by default). Versions record who saved them. Upload collections can't keep versions. New Local API methods `findVersions`, `findVersionById` and `restoreVersion` (restores as a draft by default, through `update`, so hooks, access checks and `onChange` run). New REST routes: `GET {api}/{collection}/{id}/versions`, `GET …/versions/{versionId}` and `POST …/versions/{versionId}/restore` (`?draft=false` publishes; `If-Match` supported). Deleting a document deletes its versions.
  - **Autosave.** `admin.autosave: true | { interval }` saves the editor's draft in the background after a pause in typing (default 2000 ms). Autosaves pass `autosave: true` to `update`, which records no version, and keep the existing concurrency check (`expectedUpdatedAt`).
  - **Admin.** The document editor gets a History sheet: a list of versions, a field-by-field comparison with the editor, and Restore. It also gets a Schedule dialog and "Publishes" / "Unpublishes" rows in the inspector.
  - **Scheduled publishing.** `schedule({ collection, id, publishAt?, unpublishAt? })` and `getSchedule` on draft-enabled collections. `runScheduled()` publishes due drafts and unpublishes expired documents through the regular write path (hooks, versions, `onChange` revalidation). `GET|POST {api}/_cron/publish` runs it for a cron job. It authenticates with `Authorization: Bearer <secret>` (`cron.secret` in the config, or `XENON_CRON_SECRET`, or `CRON_SECRET` for Vercel Cron), or with an admin session or admin API key. Published reads hide a document from its `unpublishAt` on, even if cron runs late. Schedules have their own API and don't add fields to documents, so no field names are newly reserved.
  - **Adapters.** `DocumentRecord` gains optional `publishAt` / `unpublishAt`. `FindArgs` gains `now`. `DatabaseAdapter` gains optional `createVersion`, `findVersions`, `findVersionById`, `deleteVersions` and `findDue`. The Postgres and PGlite adapters add the `publish_at` / `unpublish_at` columns (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`) and a `xenon_versions` table on `init()`. Existing databases upgrade in place.

## 0.3.0

### Minor Changes

- 17b58e1: Globals / Singletons (`defineGlobal`) (#10):
  
  - Added `defineGlobal({ slug, label?, fields, drafts?, admin?, access? })` and optional `globals` on `defineConfig`, along with `getGlobal`, `buildGlobalSchema`, `validateGlobalData`, and full TypeScript inference (`InferGlobalType`, `InferGlobalData`, `InferGlobalUpdateInput`, `InferGlobalDraftInput`, `GlobalSlug`, `GlobalBySlug`, `InferConfigGlobals`, `SelectGlobalInput`, `PopulateGlobalInput`, `InferQueryGlobalType`). Reserved `"globals"` as a collection slug to prevent REST route collisions.
  - Added typed Local API methods `xenon.getGlobal({ slug, draft?, select?, populate? })`, `xenon.updateGlobal({ slug, data, draft?, expectedUpdatedAt? })`, and `xenon.unpublishGlobal({ slug })`. Globals are stored in `xenon_documents` under the reserved `_xenon_globals` namespace (zero schema migrations) with identical draft/publish semantics, optimistic concurrency, batched `populate`, and `select` projection.
  - Added `xenonTags.global(slug)` (`xenon:global:{slug}`) in `xenon-cms/next` and wired `onChange` cache-tag revalidation for globals.
  - Added REST endpoints `GET/HEAD/PATCH /{api}/globals/{slug}` (with `ETag`/`304`, `Cache-Control`, `If-Match`, `?draft=true`, `?select`, `?populate`, and trusted-`Origin` CSRF enforcement) and `POST /{api}/globals/{slug}/unpublish`.
  - Added Admin UI direct sidebar entries, `⌘K` command-palette navigation, presence/soft-lock support, and `<GlobalEditor>` at `/admin/globals/{slug}` (via both Next.js RSC and HTTP `/_admin/data` + `/_admin/action`).
- 4402ea7: Collection and field lifecycle hooks (#12):
  
  - `defineCollection({ hooks })` accepts `beforeValidate`, `beforeChange`, `afterChange`, `afterRead`, `beforeDelete` and `afterDelete`. Each is one function or an array, typed from the collection's fields. Fields accept `hooks` with `beforeValidate`, `beforeChange`, `afterChange` and `afterRead`. Field hooks run inside `group`, `array` and `blocks` values and receive `value`, `siblingData` and `path`.
  - Hooks run for every write through the Local API, so REST, the admin UI and presigned uploads are covered too. The order is: access check, `beforeValidate`, validation, `beforeChange`, write, `onChange`, `afterChange`, `afterRead`. `afterRead` also runs on populated documents, before `select`. Throw a `XenonError` from a hook to reject an operation with that status. `afterChange` and `afterDelete` errors reach the caller, but the write has already been committed.
  - Hooks receive `{ data | doc, originalDoc | previousDoc, operation, draft, user, collection, context, xenon }`. Local API calls take a new `context` option, a mutable object shared by every hook in that call. The `xenon` passed to hooks forwards `context` to nested calls and fails once calls are nested more than 16 levels deep, so a hook that keeps re-triggering itself errors instead of looping forever.
  - `CollectionBySlug` (and therefore an untyped `XenonInstance`) now resolves any slug to the loose collection type instead of `never` when the config is erased.
- b9b952e: Typed batched `populate`, `select` projection, nested `where` and opt-in field indexes (#11):
  
  - `find`, `findById` and `findBySlug` accept `populate` (an explicit tree over `relation` / `media` fields, including ones inside `group`, `array` and `blocks`, with nested `select` / `populate` per relation) and `select` (an inclusion projection). Return types are inferred from both. Population is batched: one query per target collection per depth level, with no N+1, and it checks `access.read` on every populated collection.
  - REST supports the same options: `?populate[author]=true`, `?populate=author,cover`, `?select=title,slug`, `?select[seo][noIndex]=true`, or JSON values. Responses that populate a read-restricted collection are not publicly cached.
  - `where` and `sort` accept dot paths into `group` fields (`"seo.noIndex"`) in the Postgres and memory adapters.
  - Fields accept `index: true` and `unique: true`. On Postgres, `init()` creates matching expression indexes and partial unique indexes. Duplicate values throw `CONFLICT` with the field path. New export: `UniqueConflictError`.

## 0.2.1

No changes in this release.

## 0.2.0

### Minor Changes

- 7834147: Composite and essential fields: `date()`, `datetime()`, `email()`, `url()`, `json({ schema })`, `group()`, `array()`, and `defineBlock()` + `blocks()`, with full type inference, nested validation and defaults, and admin inputs (drag-to-reorder rows, a block picker, nested error paths). Boolean fields can use `admin.display: "checkbox"`. In the title/body editor layout, `blocks` fields and fields with `admin.position: "main"` render under the body. Partial updates now merge `group` values recursively (arrays, blocks and `json` are replaced), and stored data is trimmed to the current schema before an update, so removing a nested field or block type no longer breaks updates to existing documents.
- 07a6996: `admin.condition` shows a field only when its sibling data matches, using the `where` operators (`{ kind: { equals: "video" } }`, with `and` / `or`). The admin shows and hides fields as you type; the server applies the same rule, so hidden fields skip `required`, row minimums and custom `validate` while their values are still type-checked. Conditions are validated in `defineConfig` (sibling keys, known operators, plain JSON). New export: `evaluateCondition`.
- 4703a0a: Add presigned direct-to-S3/R2 uploads with `HEAD` + Range-`GET` security and dimension verification (#13):
  
  - Extend `StorageAdapter` with optional `createPresignedUpload`, `head`, and `readRange` methods, implemented in `S3StorageAdapter` using `aws4fetch` SigV4 query signing (binding `content-type` and `content-length`).
  - Add `presignUpload`, `completeUpload`, and `supportsPresignedUploads` to the Local API (`xenon-cms/server`) plus `POST /{api}/{collection}/_presign` and `POST /{api}/{collection}/_complete` in `xenon-cms/http`.
  - Preserve Critical #2 upload security on `_complete`: verifies an HMAC-signed upload token, key prefix, replay guard, `HEAD` (`Content-Length <= maxFileSize` and non-active `Content-Type`), and a bounded `<= 64 KB` Range `GET` to sniff magic bytes, block active markup, and extract `image-size` dimensions before saving (immediately deleting rejected objects).
  - Automatically switch admin UI uploads (`useServices().upload`) to the 3-step direct-to-storage flow when the configured storage adapter supports presigned uploads, keeping multipart uploads for local storage.
- bd755c5: Editable slugs. `create` / `update` accept `slug` (a string sets it by hand; `null` switches back to automatic), and so does a top-level `slug` in REST POST/PATCH bodies. Hand-set slugs are normalized, refused with `CONFLICT` when taken, and no longer follow `slugFrom`. On a published document, a slug change saved as a draft stays pending until the next publish, so the live URL never changes early. The admin's Publishing panel gets a slug editor with a live preview, "Use automatic", and a note while a change awaits publishing. `slugify` moves to an isomorphic module (still exported from `xenon-cms/server`).
- 1db76b5: Decouple HTTP, routing, and rich-text HTML rendering from Next.js (`P1a`):
  
  - Add `xenon-cms/http` with framework-agnostic `createHandler(config)` (`(req: Request) => Promise<Response>`), strong `ETag` / `304 Not Modified` + access-aware `Cache-Control` on `GET`/`HEAD` endpoints, and HTTP admin transport (`POST /_admin/action`, `GET /_admin/data`) backed by a single shared server-side admin loader (`loadAdminData`).
  - Add `AdminRouter` context (`AdminRouterProvider`, `AdminLink`, `useAdminRouter`, `useAdminPathname`) with a built-in History API default router (`createHistoryRouter`), removing all `next/link` and `next/navigation` imports from `xenon-cms/client`.
  - Add `xenon-cms/html` with zero-React `renderRichTextToHtml(doc, { blocks, components, className })`, `escapeHtml`, and shared `safeUrl()` / `richTextToPlainText()`.
  - Keep `xenon-cms/next` (`createApiHandler`, `AdminPage`, `runAdminAction`) as thin backwards-compatible wrappers over `xenon-cms/http` and an internal Next router adapter (`xenon-cms/next-client`).

## 0.1.1

No changes in this release.

## 0.1.0

### Minor Changes

- 1f5858e: First public release: typed collections with Zod validation, Postgres/PGlite/Drizzle adapters, local and S3/R2 storage, drafts and publishing, REST and Local APIs, BetterAuth, and the admin UI.
