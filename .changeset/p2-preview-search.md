---
"xenon-cms": minor
---

Add framework-agnostic Live Preview (#14) and PostgreSQL `tsvector` full-text search (#17).

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
