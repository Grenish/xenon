# XenonCMS Roadmap

**Positioning:** A lightweight, code-first headless CMS for any TypeScript web app — first-class on Next.js.

- **Zero-codegen TypeScript** (`fields` as an object + `const` type parameters)
- **Zero-migration schema evolution** (polymorphic JSONB + PGlite zero-setup dev + bring-your-own Drizzle PG)
- **Framework-agnostic Web-Standard core** (Next.js flagship + Hono/Bun/Deno/Workers, Astro, TanStack Start, SvelteKit/Nuxt/Express recipes)
- **AI-native authoring** (`xenon-cms/mcp`) and an editorial UI teams enjoy

Live progress is tracked on the **[XenonCMS v1.0 Roadmap Board](https://github.com/users/Grenish/projects/5)**, in the pinned umbrella issue **[#29 — XenonCMS v1.0 Roadmap](https://github.com/Grenish/xenon/issues/29)**, and across the GitHub [Milestones](https://github.com/Grenish/xenon/milestones).

---

## [P0: Launch & Hygiene (v0.1.0)](https://github.com/Grenish/xenon/milestone/1)

Turn the audited baseline into an installable, CI-verified `0.1.0` release.

- [#5](https://github.com/Grenish/xenon/issues/5) — Fix remaining Low audit bugs (#23–#28)
- [#6](https://github.com/Grenish/xenon/issues/6) — Add GitHub Actions CI, Changesets release workflow & reproducible benchmarks
- [#7](https://github.com/Grenish/xenon/issues/7) — Ship `npx xenon init` CLI & `create-xenon-app` with pluggable framework templates

## [P1: Modeling, Query, Hooks & Core HTTP](https://github.com/Grenish/xenon/milestone/2)

Decouple the HTTP/UI core first (`P1a`), then remove the MVP modeling and querying ceiling.

- [#8](https://github.com/Grenish/xenon/issues/8) — `[P1a]` Framework decoupling: `xenon-cms/http`, `AdminRouter`, HTTP admin transport & `xenon-cms/html`
- [#9](https://github.com/Grenish/xenon/issues/9) — Composite & essential fields: `date`, `email`, `url`, `json`, `group`, `array`, `defineBlock()` + `blocks()`
- [#10](https://github.com/Grenish/xenon/issues/10) — Globals / Singletons (`defineGlobal`)
- [#11](https://github.com/Grenish/xenon/issues/11) — Typed batched `populate`, `select` projection, nested `where` & opt-in JSONB expression indexes
- [#12](https://github.com/Grenish/xenon/issues/12) — Collection & field lifecycle hooks (`beforeValidate`, `beforeChange`, `afterChange`, `afterRead`, `beforeDelete`)
- [#13](https://github.com/Grenish/xenon/issues/13) — Presigned direct-to-S3/R2 uploads with `HEAD` + Range-`GET` security & dimension guardrail

## [P2: Editorial Experience](https://github.com/Grenish/xenon/milestone/3)

Features content teams evaluate in the first 10 minutes of a demo.

- [#14](https://github.com/Grenish/xenon/issues/14) — Framework-agnostic Live Preview (signed preview token + Next.js `draftMode()` wrapper & split-pane iframe)
- [#15](https://github.com/Grenish/xenon/issues/15) — Version history (`xenon_versions`), diff viewer, one-click rollback & draft autosave
- [#16](https://github.com/Grenish/xenon/issues/16) — Scheduled publishing (`publishAt` / `unpublishAt`) with cron endpoint & query-time guard
- [#17](https://github.com/Grenish/xenon/issues/17) — PostgreSQL `tsvector` full-text search across collections, admin list & `⌘K`
- [#18](https://github.com/Grenish/xenon/issues/18) — Admin editorial ergonomics: soft delete / trash, duplicate, bulk actions, list filters & column chooser

## [P3: Access, Production, MCP & Multi-Framework](https://github.com/Grenish/xenon/milestone/4)

Production security, AI authoring, and first-party multi-framework expansion.

- [#19](https://github.com/Grenish/xenon/issues/19) — Row-level access (`boolean | Where`), field-level access, custom roles & DB-backed scoped API keys
- [#20](https://github.com/Grenish/xenon/issues/20) — Native MCP Server (`xenon-cms/mcp`) for access-controlled AI content authoring
- [#21](https://github.com/Grenish/xenon/issues/21) — Signed HMAC webhooks, delivery log, audit log & Postgres `PresenceStore`
- [#22](https://github.com/Grenish/xenon/issues/22) — BetterAuth production polish: pluggable mailer (password reset & invites), OAuth/SSO & 2FA
- [#23](https://github.com/Grenish/xenon/issues/23) — Multi-framework expansion: Mounted Admin SPA, `xenon-cms/astro`, `xenon-cms/tanstack-start`, recipes & host conformance suite

## [P4: Rich Text & Media v2](https://github.com/Grenish/xenon/milestone/5)

Close the authoring gap with Sanity Portable Text and Payload Lexical.

- [#24](https://github.com/Grenish/xenon/issues/24) — Rich Text v2: Media Library picker, inline `defineBlock()` embeds (`react` + `html`), internal doc-ID links & tables
- [#25](https://github.com/Grenish/xenon/issues/25) — Media v2: focal point picker, responsive variants / core `srcset` helper, blur placeholders, reference tracking & multi-upload

## [P5: Ecosystem, Extensibility & i18n](https://github.com/Grenish/xenon/milestone/6)

Global content, external consumers, and lightweight extensibility without core bloat.

- [#26](https://github.com/Grenish/xenon/issues/26) — Localization (i18n): JSONB locale maps, fallback chains, admin locale switcher & UI translations
- [#27](https://github.com/Grenish/xenon/issues/27) — Config-transform plugin API (`seo`, `redirects`, `search`), custom admin components & white-label branding
- [#28](https://github.com/Grenish/xenon/issues/28) — OpenAPI 3.1 generator, typed `createXenonClient`, `xenon-cms/react-router`, data/migration CLI & AI field actions

---

## Explicit Non-Goals (v1.0)

- No GraphQL API (Local API + typed REST + OpenAPI).
- No non-Postgres SQL dialects (Postgres, PGlite, Drizzle PG, and Memory only).
- No native Vue or Svelte admin UIs (non-React hosts use the Mounted Admin SPA + `xenon-cms/html`).
- No Yjs realtime co-editing or plugin marketplace before core stabilizes.

## Deferred (Post-v1.0)

Media folders/tags, per-locale slugs (optional side table), multi-tenancy, and hosted cloud.
