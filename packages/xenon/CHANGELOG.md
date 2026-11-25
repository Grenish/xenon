# xenon-cms

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
