# Handoff — if Claude (coordinator) is unavailable

Written by Claude so work continues when Claude's usage runs out. **Codex becomes interim coordinator**
when Claude is unavailable (no reply to a `t3_thread_send` for ~15 minutes, or the user says so).
When Claude returns, Claude reads this file + the message log in `docs/COORDINATION.md` and takes over again.

Last updated: 2026-11-15 — Phases 2–4 complete and verified, uncommitted. "Remaining work" below is done; see the
Phase 4 board and message log in `docs/COORDINATION.md`. Next step is the user's review and commit decision.

## Standing rules (from the user — non-negotiable)

- **Commits only when the user asks.** Never commit `docs/`. **No co-author trailers** (neither Claude nor Codex).
- Don't start a new phase's *design decisions* without the user: ask them with concrete options + a recommendation.
- Auth stays **BetterAuth**. UI stays shadcn **Base UI** components, **Remix Icon**, `xe:` prefix, smooth/natural/professional look
  (marketers + developers), RSC + Server Actions.
- Shared working tree: no `git checkout/stash/reset/clean`, no branches.

## Interim-coordinator permissions for Codex

While Claude is away Codex may edit Claude-owned files **only to finish the tasks below**, and must append every
such change (file + reason) to the "Message log" in `docs/COORDINATION.md` so Claude can review it.
Don't redesign contracts (`docs/CONTRACTS.md`); if something must change, make the smallest change and log it.

## Remaining work, in order

### 1. Finish P3-C2 — `DocumentEditor` (Codex's own task)
`src/ui/form/document-editor.tsx` must export `DocumentEditor({ collection, doc })` (see the P3 assignment message).
`src/ui/client.ts` already imports it. Then: `cd packages/xenon && bun run typecheck && bun run test && bun run build`.

### 2. First real run of the playground (P4-1, was Claude's)
```bash
cd packages/xenon && bun run build          # must produce dist/client.js starting with "use client"; and dist/styles.css
cd ../../apps/playground && bun run typecheck && bun run build && bun run dev
```
Already wired (by Claude): `src/xenon.config.ts` (PGlite in `.xenon/pgdata`, local uploads in `.xenon/uploads`),
`src/app/admin/[[...segments]]/page.tsx`, `src/app/api/xenon/[...slug]/route.ts`, `src/lib-content.ts`
(`"use cache"` + `cacheTag(xenonTags.collection(...))`), `src/app/page.tsx`, `src/app/posts/[slug]/page.tsx`,
`next.config.ts` (`cacheComponents: true`, `serverExternalPackages: ["@electric-sql/pglite"]`), `.env.example`.

**Likely issues to check first** (none of these have been run yet):
- PGlite under Next/Turbopack (WASM). If it fails, try adding `"xenon-cms"`-internal deps to `serverExternalPackages`
  only for pglite/postgres — never externalize `xenon-cms` itself (it must be bundled so the `"use client"` boundary works).
- `"use cache"` functions hit the DB during `next build` prerender → `.xenon/pgdata` is created at build time. Acceptable for
  the playground. If the build fails because of it, make the home/post pages dynamic (`await connection()`) and note it.
- `revalidateTag(tag, { expire: 0 })` from `getXenon` → publishing in /admin should update `/` immediately.
- BetterAuth sign-in from a Server Action relies on the `nextCookies()` plugin (added in `src/next/xenon.ts`).
- Admin is rendered inside the playground root layout. The scoped `.xenon-admin` reset + `xe:` prefix should hold;
  report any style leakage. Unlayered host CSS beats us — if needed, move admin to a route group with its own root layout.

**Click-through checklist** (use the preview tools / a browser):
1. `/admin` → redirects to `/admin/setup` → create the first admin → lands on the dashboard.
2. Media: Upload an image (alt required) → it appears in the grid with a thumbnail; file served from `/api/xenon/_files/...`.
3. Posts: New post → Save draft (⌘S) → status Draft, not on `/`. Publish (⌘↵) → appears on `/` and `/posts/<slug>`.
4. Edit a published post, Save draft → badge "Unpublished changes", live site unchanged. Publish → live updates.
5. Rich text: headings, lists, link, image from media picker → renders on the post page via `<RichText>`.
6. Relation field (`related`) picks other posts; select hasMany (`tags`); boolean; number.
7. ⌘K palette: search a post, jump to it; "New post"; theme switch. Dark/light/system all look right.
8. Team: add an editor, change role, set password, remove. Sign out / sign in as editor (no Team link).
9. Account: change name and password.
10. Keyboard: `/` focuses list search, `c` creates, j/k + Enter open rows.

Fix bugs in your own files directly; for Claude-owned files make minimal fixes and log them.

### 3. Phase 4 wrap-up
- `packages/xenon/README.md`: what Xenon is, install, the 3-file integration (copy from the playground), config reference
  (fields, collections, adapters, auth/API keys), Local API, REST endpoints, `<RichText>`, styling/isolation notes.
- Root `README.md`: monorepo layout + commands.
- Final verification: `bun run build && bun run test && bun run typecheck` at the root, playground `next build`.
- Report to the user (summary + what to try). **Ask the user before committing** (no `docs/`, no co-author).

## Key facts for orientation

- Contracts: `docs/CONTRACTS.md` (§1 core, §2 adapters, §3 Local API, §4 REST, §5 auth, §6 admin UI).
- Decisions: `docs/DECISIONS.md`. Board + ownership + message log: `docs/COORDINATION.md`.
- Build: two tsup configs (server entries + one `"use client"` client bundle with `treeshake: false`, otherwise rollup
  drops the directive). Server code imports UI only via `"xenon-cms/client"` (tsconfig `paths` maps it to `src/ui/client.ts`).
  CSS: `tailwindcss -i src/ui/styles/admin.css -o dist/styles.css`.
- Admin data flow: user-land `"use server"` `action` → `runAdminAction(config, input)` (`src/next/admin/action.ts`);
  client gets `AdminServices` via `useAdmin()`; uploads go through REST multipart.
- Real-Postgres test: `XENON_TEST_DATABASE_URL=postgres://... bun test test/adapters/postgres.test.ts`
  (Docker Hub is unreachable here — start a temp cluster with `initdb` + `pg_ctl -o "-p 55432 -k /tmp"`).
