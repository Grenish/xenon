---
"xenon-cms": minor
---

Decouple HTTP, routing, and rich-text HTML rendering from Next.js (`P1a`):

- Add `xenon-cms/http` with framework-agnostic `createHandler(config)` (`(req: Request) => Promise<Response>`), strong `ETag` / `304 Not Modified` + access-aware `Cache-Control` on `GET`/`HEAD` endpoints, and HTTP admin transport (`POST /_admin/action`, `GET /_admin/data`) backed by a single shared server-side admin loader (`loadAdminData`).
- Add `AdminRouter` context (`AdminRouterProvider`, `AdminLink`, `useAdminRouter`, `useAdminPathname`) with a built-in History API default router (`createHistoryRouter`), removing all `next/link` and `next/navigation` imports from `xenon-cms/client`.
- Add `xenon-cms/html` with zero-React `renderRichTextToHtml(doc, { blocks, components, className })`, `escapeHtml`, and shared `safeUrl()` / `richTextToPlainText()`.
- Keep `xenon-cms/next` (`createApiHandler`, `AdminPage`, `runAdminAction`) as thin backwards-compatible wrappers over `xenon-cms/http` and an internal Next router adapter (`xenon-cms/next-client`).
