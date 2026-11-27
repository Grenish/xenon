---
"xenon-cms": minor
---

Globals / Singletons (`defineGlobal`) (#10):

- Added `defineGlobal({ slug, label?, fields, drafts?, admin?, access? })` and optional `globals` on `defineConfig`, along with `getGlobal`, `buildGlobalSchema`, `validateGlobalData`, and full TypeScript inference (`InferGlobalType`, `InferGlobalData`, `InferGlobalUpdateInput`, `InferGlobalDraftInput`, `GlobalSlug`, `GlobalBySlug`, `InferConfigGlobals`, `SelectGlobalInput`, `PopulateGlobalInput`, `InferQueryGlobalType`). Reserved `"globals"` as a collection slug to prevent REST route collisions.
- Added typed Local API methods `xenon.getGlobal({ slug, draft?, select?, populate? })`, `xenon.updateGlobal({ slug, data, draft?, expectedUpdatedAt? })`, and `xenon.unpublishGlobal({ slug })`. Globals are stored in `xenon_documents` under the reserved `_xenon_globals` namespace (zero schema migrations) with identical draft/publish semantics, optimistic concurrency, batched `populate`, and `select` projection.
- Added `xenonTags.global(slug)` (`xenon:global:{slug}`) in `xenon-cms/next` and wired `onChange` cache-tag revalidation for globals.
- Added REST endpoints `GET/HEAD/PATCH /{api}/globals/{slug}` (with `ETag`/`304`, `Cache-Control`, `If-Match`, `?draft=true`, `?select`, `?populate`, and trusted-`Origin` CSRF enforcement) and `POST /{api}/globals/{slug}/unpublish`.
- Added Admin UI direct sidebar entries, `⌘K` command-palette navigation, presence/soft-lock support, and `<GlobalEditor>` at `/admin/globals/{slug}` (via both Next.js RSC and HTTP `/_admin/data` + `/_admin/action`).
