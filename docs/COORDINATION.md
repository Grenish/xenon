# Coordination board

Coordinator: **Claude** — T3 thread `e60b1e18-f287-4562-ba12-bd7b5a95b12a`.
All agents share one working tree on `main`. Follow the rules in `/AGENTS.md`.

## Roster

| agent | thread | role |
|-------|--------|------|
| Claude (claude-opus-5-5) | `e60b1e18-f287-4562-ba12-bd7b5a95b12a` | coordinator; core implementation |
| Codex (gpt-6.1-sol) | `57d0084e-3d09-47e1-a06b-35257ff9752c` | playground + test suite |

New agents: add yourself only after the coordinator assigns you (the coordinator updates this table).

## File ownership (current — Phase 3)

| path | owner |
|------|-------|
| root configs, `bun.lock`, `AGENTS.md`, `CLAUDE.md`, `docs/**` | Claude |
| `packages/xenon/{package.json,tsconfig.json,tsup.config.ts}`, build scripts | Claude |
| `packages/xenon/src/{index.ts,core,adapters/types.ts,adapters/postgres,server,auth}/**` | Claude |
| `packages/xenon/src/next/{index.ts,xenon.ts}`, `src/next/admin/**` | Claude |
| `packages/xenon/src/ui/{shared,styles,admin}/**`, `src/ui/client.ts` | Claude |
| `packages/xenon/test/adapters/postgres.test.ts` | Claude |
| `packages/xenon/src/storage/**`, `src/adapters/memory.ts`, `src/next/{api-handler,query}.ts` | Codex |
| `packages/xenon/src/ui/{components,lib,form}/**` | Codex |
| `packages/xenon/test/**` (except postgres.test.ts) | Codex |
| `apps/playground/**` | Claude in Phase 4 (unassigned now) |
| `apps/web/**` (landing page), except the row below | Opus thread 0a44b91c (lead) |
| `apps/web/src/demos/types-demo.{tsx,css}` | Codex gpt-6.2-astra thread 155c8026 (task done) |

## Phases

User gates: Phase 2 approved (2026-11-15). **Before building any UI (Phase 3), the coordinator asks the user for UI decisions.** Commits: only on user request, never commit `docs/`, no co-author trailers.

### Phase 1 — core schema engine, inference, Zod validation  *(done — awaiting user review)*

| id | task | owner | status |
|----|------|-------|--------|
| P1-1 | Monorepo scaffold, tsconfig, tsup config | Claude | done |
| P1-2 | Core: field helpers, `defineCollection`, `defineConfig`, inference types, Zod builder (`packages/xenon/src/**`) | Claude | done |
| C-1 | `apps/playground` skeleton (Next 16, React 19, TS, Tailwind 4) linked to `xenon-cms` + sample `src/xenon.config.ts` | Codex | done |
| C-2 | Test suite for core against `docs/CONTRACTS.md` (`packages/xenon/test/**`): runtime (`bun:test`) + type tests | Codex | done |

### Phase 2 — Drizzle Postgres adapter, storage adapters, Local API, REST handler, BetterAuth  *(done — 300 tests green)*

| id | task | owner | status |
|----|------|-------|--------|
| P2-1 | Adapter contracts + CONTRACTS §2–5 | Claude | done |
| P2-2 | Postgres (Drizzle) adapter: postgres-js + PGlite, `xenon_documents`, where compiler, auth tables | Claude | done (conformance 47/47 on PGlite + PG 18) |
| P2-3 | Local API `createXenon` (drafts, slugs, uploads, access, defaults on read) | Claude | done |
| P2-4 | BetterAuth integration (`src/auth/`), `getXenon` + revalidateTag (`src/next/xenon.ts`) | Claude | done |
| P2-C1 | `LocalStorageAdapter`, `S3StorageAdapter` (aws4fetch) + tests | Codex | done |
| P2-C2 | `memoryAdapter` + DatabaseAdapter conformance suite | Codex | done |
| P2-C3 | REST `createApiHandler` + query parsing + tests | Codex | done |
| P2-C4 | REST hardening: file CSP/attachment/cache, cookie-write Origin check | Codex | done |

### Phase 3 — Admin UI, FormRenderer, Tiptap, `"use client"` bundling, styles.css  *(done)*

User decisions: smooth/natural/professional look (marketers + devs); shadcn **Base UI** vendored; **Remix Icon**;
RSC + Server Actions; `xe:` prefix + `.xenon-admin` scoped reset.

| id | task | owner | status |
|----|------|-------|--------|
| P3-1 | Theme tokens + scoped reset (`src/ui/styles/admin.css`), client-config + services contract | Claude | done |
| P3-2 | Build: `"use client"` client bundle + `styles.css` | Claude | done |
| P3-3 | AdminPage server shell, router, auth guard, `runAdminAction`, login/setup/users | Claude | done |
| P3-4 | Client shell: sidebar, ⌘K palette, collection list, dashboard, team, account | Claude | done |
| P3-5 | `xenon-cms/react` `<RichText>` renderer | Claude | done |
| P3-C1 | Vendored shadcn Base UI components (`xe:` prefix, Remix icons), `cn` | Codex | done |
| P3-C2 | DocumentEditor, FormRenderer, field inputs, Tiptap editor, media + relation pickers | Codex | done |

### Phase 4 — Full playground integration  *(done, uncommitted — awaiting user review; 318 tests green)*

| id | task | owner | status |
|----|------|-------|--------|
| P4-1 | Playground integration (config, admin page, API route, Local API pages w/ `use cache`) | Claude | done |
| P4-2 | Remove `[xenon-debug]` log from `runAdminAction` | Claude | done |
| P4-3 | Bug: rich-text node `attrs` lost on save (null-prototype attrs dropped by the Server Action encoder) | Claude | fixed + regression test |
| P4-4 | Bug: fresh document shows "Unsaved changes" / "Unpublished changes" right after publish | Claude | fixed (browser-verified) |
| P4-5 | UI fixes: media picker tabs, toolbar wrap, status badge without drafts, slug row without `slugFrom` | Claude (in Codex-owned files) | done |
| P4-6 | Browser click-through (HANDOFF checklist) incl. Team, Account, ⌘K, themes, keyboard, relation, unpublish, delete, editor role | Claude | done — 3 more bugs found and fixed (see log) |
| P4-7 | `packages/xenon/README.md`, root `README.md`, `XENON_URL` in playground `.env.example` | Claude | done |
| P4-8 | Final verification: typecheck, test, build, playground `next build` | Claude | all green |

## Message log (short)

- Coordinator → Codex: assigned C-1, C-2.
- Contract clarified: defaultColumns allows system keys; textarea has no `pattern`; draft allows null on required;
  upload fields read-only; null on defaulted fields normalizes to default in every mode; `InferDraftInput` added.
- Coordinator → Codex: P1-2 ready; test-harness fixes requested (test.each spreading, helper typing).
- Codex → Coordinator: C-1, C-2 done; coordinator re-verified (111 tests, typecheck, next build green).
- Phase 1 committed (c4f41dd, docs/ intentionally uncommitted). Coordinator → Codex: assigned P2-C1..C3.
- Conformance suite caught 2 where-compiler bugs (non-short-circuit casts, inherited keys) — fixed.
- Real-Postgres run: `XENON_TEST_DATABASE_URL=... bun test test/adapters/postgres.test.ts` (Docker Hub unreachable here; used a native temp cluster).
- Phase 2 complete; coordinator re-verified (300 tests, typecheck, build). Waiting on user UI decisions for Phase 3.
- User Phase 3 decisions recorded. Coordinator → Codex: assigned P3-C1, P3-C2.
- Handoff: docs/HANDOFF.md written; Codex is interim coordinator if Claude becomes unavailable (user request). Codex logs any edits to Claude-owned files here.
- **Phase 4 wrap-up (Claude, 2026-11-15).** Nothing committed. Verified in headless Chrome against `next dev`.
  - Root cause of lost rich-text attrs: ProseMirror builds `attrs` with `Object.create(null)`; React's Server Action
    reply encoder replaces null-prototype objects with opaque temporary references, so the server never received them.
    New `src/ui/shared/plain.ts` (`toPlainJson`), applied in `useAdminRuntime().run` (every action input) and in the
    editor's `onUpdate`.
  - Root cause of the false dirty state: `editor.setEditable()` emits an update by default (on mount and each time
    `pending` toggles, i.e. after every save), pushing Tiptap's JSON into form state; it never string-equalled the
    baseline (jsonb key order, default attrs). The header badge shows "Unpublished changes" for any dirty published
    doc, which is what appeared after publishing — there was no extra save. Fix: `setEditable(x, false)` plus
    `src/ui/form/rich-text-schema.ts` (`normalizeRichText`, shared extensions) used by `initialData` and the editor sync.
  - Found during the click-through and fixed: (1) ⌘/Ctrl+Enter inside the rich-text editor inserted a hard break
    instead of publishing — save shortcuts now run in the capture phase; (2) changing your password bounced you to the
    dashboard via `/admin/login` — `AdminPage` now reads the session from `cookies()` (reflects cookies rotated by the
    action) instead of the stale request header; (3) the relation combobox popup collapsed to a sliver at the bottom of
    the page instead of flipping — `min-h` on the popup.
  - Tabs/separators/toggle groups: vendored components use `data-horizontal:` / `data-vertical:` variants but Base UI
    sets `data-orientation`; added two `@custom-variant`s in `src/ui/styles/admin.css` (fixes picker tabs, list status
    tabs, and the previously invisible toolbar separator).
  - **Edits to Codex-owned files** (requested by the user's task list): `src/ui/form/{model.ts,rich-text-editor.tsx,
    document-editor.tsx}`, new `src/ui/form/rich-text-schema.ts`, `src/ui/components/combobox.tsx` (one class),
    new `test/ui/rich-text-plain-json.test.ts`.
  - Observed, not changed: with `cacheComponents`, Next keeps previous routes mounted but hidden, so the DOM contains
    hidden duplicate admin roots/toasts (not visible to users). Rich-text image button still uses the first upload
    collection (open question for the user). Playground data: test editor and test posts were removed again;
    "Hello from Xenon" is published with an H2 heading.
- **UI refresh (Claude, 2026-11-15, uncommitted).** User decisions in DECISIONS.md. Theme bug root cause: per-route
  theme state in routes kept mounted by `cacheComponents` → shared store. `window.confirm` (leave with unsaved changes)
  → AlertDialog. New: `src/ui/admin/{settings.tsx,theme-store.ts}`, `src/ui/form/slash-command.ts`; rewritten
  `rich-text-editor.tsx`, `auth-screen.tsx`; tokens in `admin.css`; routes `/admin/settings[/appearance|/team]`
  (`/admin/account`, `/admin/users` redirect); actions `account.sessions|revokeSession|revokeOtherSessions` (session ids
  only; tokens stay server-side). `account.tsx` trashed. Dependency added: `@tiptap/suggestion@3.34.0`.
  Edits in Codex-owned files: `src/ui/form/{rich-text-editor.tsx,slash-command.ts,document-editor.tsx}`.
  Verified: typecheck, 318 tests, tsup build; browser-checked login, settings, theme across back/forward, slash, bubble,
  ⌘K link, leave dialog. Not run: playground `next build` (user's `next dev` was running).
- **Editor canvas + SSR fix (Claude, 2026-11-15, uncommitted).** "Duplicate use of selection JSON ID cell" on SSR:
  `@tiptap/react/menus` → `@tiptap/extension-bubble-menu` → `prosemirror-tables` was evaluated twice under Turbopack.
  Replaced BubbleMenu with a self-positioned selection menu (no menus/tables/floating-ui import left in dist).
  Document editor redesigned (user choice "Document canvas"): sticky action bar, borderless title (`useAsTitle`) +
  first richText field as canvas, all other fields in a sticky Properties panel with word count; upload collections
  keep the form. Playground: `generateStaticParams` on `/posts/[slug]` so post pages are fully cached in production.
  Verified: typecheck, 318 tests, playground `next build`, `next start` headers (`/` and posts HIT, s-maxage 30d).
- **Dashboard redesign (Claude, 2026-11-15, uncommitted).** User choice "Overview + attention". New server loader
  `src/next/admin/dashboard-data.ts` (access-checked via Local API, counts from raw adapter records: published, drafts,
  unpublished changes, media bytes, 30-day activity by last edit / creation). `src/ui/admin/dashboard.tsx` rewritten:
  stat row, single-series activity bar chart (hover/focus tooltips, sr-only table), Needs attention, Recently edited,
  Collections breakdown, New menu. Payload types in `src/ui/shared/services.ts`. Note: activity reflects last edit only
  (no edit history is stored). Verified: typecheck, 318 tests, browser in light/dark.
- **UI redesign test branch (Claude, 2026-11-18).** User asked for a new admin UI on a separate branch. Branch
  `ui/redesign` lives in its own worktree `../xenon-ui-redesign` (main tree untouched), commit 2a14195. "Framed sheet":
  tinted frame + inset white sheet, Xe element-tile mark, bundled IBM Plex Sans/Serif, one teal hue, top-bar actions via
  `useShellBar`, dashboard pipeline + recent media (`DashboardData.media`). 318 tests, typecheck, playground `next build`
  green. Awaiting user decision whether to merge into main; do not build on it until then.
- **UI redesign merged (Claude, 2026-11-18).** User approved; `main` fast-forwarded to 2a14195 (local only, not pushed).
  The framed-sheet UI is now the baseline for all admin work. Branch `ui/redesign` + worktree `../xenon-ui-redesign` kept.
- **Presence, soft locks, save-conflict check (Claude, 2026-11-18, uncommitted).** User request. Optimistic concurrency:
  `DatabaseAdapter.update(…, { ifUpdatedAt })` + `UpdateConflictError`, `updatedAt` now strictly increasing; Local API
  `update({ expectedUpdatedAt })` → CONFLICT (issue path `updatedAt`); REST `If-Match`. Presence: `PresenceStore` contract +
  `config.presence`, `src/server/presence.ts` (memory store, HMAC tokens), `POST {api}/_presence`, admin action
  `presence.token`, client `src/ui/admin/presence.tsx` (heartbeat 8 s/20 s, paused when hidden unless holding a lock,
  leave beacon), top-bar team popover, avatars on list/dashboard rows, editor lock banner/read-only/Take over, live refresh
  for viewers, conflict dialog. **Edits to Codex-owned files**: `src/adapters/memory.ts`, `src/next/api-handler.ts`,
  `src/ui/form/document-editor.tsx`, `test/adapters/conformance.ts`; new tests `test/server/presence.test.ts`,
  `test/rest/concurrency.test.ts`. Verified: 333 tests (PGlite conformance 50/50), typecheck, build, playground
  `next build`, two-user headless-Chrome run (lock, live refresh, takeover, conflict → overwrite/load theirs).
- **Playground PGlite corruption (Claude, 2026-11-18).** `next dev` failed on the first query: PGlite aborted with
  "could not locate a valid checkpoint record" (WAL damaged between 15:58 and 17:10). Cause: PGlite has no cross-process
  locking and `next build` prerenders in several worker processes that each opened `.xenon/pgdata`. Recovered with native
  `pg_resetwal -f` (PG 18) on a copy: 1 post, 1 media, 1 user intact; damaged folder kept as
  `apps/playground/.xenon/pgdata.corrupt-2026-11-18`. Prevention: `{dataDir}.lock` in the Postgres adapter (live owner →
  clear error; stale → taken over; released on close/exit) + `test/adapters/pglite-lock.test.ts`; playground
  `next.config.ts` uses `experimental.cpus: 1` when DATABASE_URL is unset. User's `dev:all` was stopped to swap the folder.
- 2026-11-18 — Landing page: Opus (0a44b91c) leads `apps/web/**`; Codex gpt-6.2-astra (155c8026) joined under Opus. Codex done: TypesDemo (`apps/web/src/demos/types-demo.{tsx,css}`). Rehearsal gates passed at 1280/390, typecheck 0; separate frame-coverage sampler exited 2 (timing gaps), left with Opus. Root `bun.lock` changed for the new workspace.
- 2026-11-19 — Landing page done, uncommitted, awaiting user review (Opus 0a44b91c). `apps/web`: Next 16.4.6 / React 19.3.1 / @remixicon/react, plain CSS, dev :3100, prod :3101, `/capture` filming route, vendored stageshow kit (MIT, licenses in `src/stageshow/`). bun.lock: workspace entry only (verified). Checks: tsc 0, taste lint 0/0, inspector 0 FAIL (2 WARN: no photos/video), film gate passed 1280+390; motion coverage inconclusive (exit 2, sampling gaps).
