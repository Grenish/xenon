# Decisions log

Short ADR-style entries. Newest last. Owner: coordinator.

1. **Bun workspaces, ESM-only package.** Next 16 / React 19 consumers are ESM; no CJS build.
2. **TypeScript 5.9 (not 7.x) for the toolchain.** tsup's `.d.ts` bundling relies on the
   JS compiler API, which the Go-native TS 7 doesn't provide the same way. Revisit later.
3. **Fields are an object keyed by name**, not an array. Gives exact key inference with no codegen
   and makes `slugFrom`/`useAsTitle` type-checkable.
4. **`const` type parameters** on all helpers instead of asking users for `as const`.
5. **Zod v4** for runtime validation, built dynamically from field definitions.
6. **Dates as ISO strings** in documents (safe across RSC boundaries and REST).
7. **Relations/media store ids** (`string` / `string[]`); population is a later Local API option.
8. **Auth: BetterAuth** (user preference) with `admin` / `editor` roles. Details in Phase 2/3.
9. **Polymorphic `xenon_documents` table** (JSONB `data` + `draft_data`) via Drizzle — Phase 2.
10. **Null on a defaulted field normalizes to its default** in every validation mode, so read types
    (`key: V`) stay truthful. Input types still forbid `null` on required+default fields.
11. **Custom `validate` hooks run in the same pass as built-in checks**, so all errors come back at once.
    Implemented as a single transform, because Zod v4 skips object refinements after a nested abort.
12. **Phase 2 note:** the Local API must apply `defaultValue`s on read for documents that predate a
    field's addition (the JSONB schema evolves without migrations).
13. **PGlite is the zero-setup default for dev/tests**; `postgres` (postgres-js) for servers; or bring any Drizzle pg db.
    Clients are cached on `globalThis` by connection string / data dir so Next dev HMR never double-opens PGlite.
14. **Auth tables are generated from BetterAuth's own `getSchema()`** (DDL + Drizzle tables), so BetterAuth plugin
    columns are picked up without migrations; additive `ADD COLUMN IF NOT EXISTS` handles BetterAuth upgrades.
15. **Public sign-up disabled**; admin plugin roles `admin`/`editor`; users created via `auth.api.createUser`.
16. **Upload collections ignore drafts.** Storage key kept in internal `data._file`, never returned.
17. **`update` validates the merged working copy**, so partial PATCHes work while required rules still hold.
18. **S3 via `aws4fetch`** (tiny, R2-friendly) instead of the AWS SDK.
19. **UI refresh (user decisions, 2026-11-15):** monochrome palette (neutral greys, black/white primary; color only for
    status); minimal centered login (text wordmark, no card/glow/logo tile); rich text = slash menu + selection bubble
    menu + slim one-line toolbar (`@tiptap/suggestion` added); Settings = Profile & security (incl. sessions),
    Appearance, Team. No native `confirm/alert/prompt` in the admin (except the browser's own beforeunload prompt).
20. **Theme lives in a module-level store** (`src/ui/admin/theme-store.ts`), not React state, because
    `cacheComponents` keeps previously visited routes mounted and each has its own `<AdminRoot>`.

## 2026-11-18 — Admin UI: "framed sheet" (user-approved)
Tinted frame (sidebar + 48px top bar) around an inset white sheet; Xe element-tile mark; bundled IBM Plex Sans (UI) and
IBM Plex Serif (writing canvas); one teal hue (`--brand`) on the mark, main data series and active tab; flat surfaces,
no resting shadows. Pages put breadcrumbs/actions in the top bar with `useShellBar` (`src/ui/admin/shell-bar.ts`).
