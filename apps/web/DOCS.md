# Docs — architecture

Status: built, 2026-11-19. Owner: Opus (landing lead). Builders: Opus (UI) + gpt-6.2-astra (content pipeline, thread 3dd7f872). Content: gemini-3.8-flash.

The docs live at `/docs` inside `apps/web`, in the same tokens, type and grounds as the landing page. They're
fully static: every page is prerendered at build, nothing runs on the server at request time.

## 1. Who owns what

| path | owner |
|------|-------|
| `apps/web/content/docs/**/*.mdx` | **Gemini** (content only; never touches code) |
| `src/docs/nav.ts` (sitemap data), `src/docs/source.ts` (loader, frontmatter, MDX compile, TOC, prev/next) | **astra** |
| `src/app/docs/[[...slug]]/page.tsx` (static params, metadata), `src/app/docs/search.json/route.ts` | **astra** |
| `scripts/docs-check.ts` + `docs:check` script (the gate, §6) | **astra** |
| `src/app/docs/layout.tsx` (top bar, sidebar, mobile sheet) | Opus |
| `src/docs/ui/**` (DocArticle, Sidebar, Toc, PrevNext, SearchDialog) | Opus |
| `src/docs/components/**`, `src/docs/mdx-components.tsx` (the §4 vocabulary), `src/docs/docs.css` | Opus |
| landing page `DOCS` links | Opus |

The seam is the types in `nav.ts` / `source.ts` (`NavSection`, `DocPage`, `getPage`, `allSlugs`); changes to them are
agreed in thread first.

Anything else in `apps/web` (landing page, demos, shaders) is out of scope for the docs work.

## 2. Sitemap

URLs are `/docs/<section>/<page>`; `/docs` itself is the Introduction. The file for a URL is
`content/docs/<section>/<page>.mdx` (`/docs` → `content/docs/index.mdx`).

```
Getting started
  /docs                              Introduction
  /docs/start/installation           Installation
  /docs/start/quickstart             Quickstart (first collection → admin → query on a page)
  /docs/start/project-structure      Project structure (the 3 files and 1 setting)
Concepts
  /docs/concepts/collections         Collections
  /docs/concepts/fields              Fields
  /docs/concepts/drafts              Drafts and publishing
  /docs/concepts/access              Access control
  /docs/concepts/types               Type inference
Admin
  /docs/admin/setup                  Mounting the admin at /admin
  /docs/admin/editors                Users, roles and invites
  /docs/admin/presence               Presence and soft locks
Guides
  /docs/guides/querying              Querying content in Server Components
  /docs/guides/caching               Caching and revalidation
  /docs/guides/uploads               Uploads and media
  /docs/guides/postgres              Postgres (and PGlite for local dev)
  /docs/guides/storage-s3            S3-compatible storage
  /docs/guides/rest-api              Using the REST API from other clients
  /docs/guides/deploying             Deploying
Reference
  /docs/reference/fields             Field helpers
  /docs/reference/define-collection  defineCollection
  /docs/reference/define-config      defineConfig
  /docs/reference/local-api          Local API (xenon-cms/server)
  /docs/reference/next               xenon-cms/next
  /docs/reference/rest               REST endpoints
  /docs/reference/adapters           Database and storage adapters
  /docs/reference/errors             Errors
```

Source of truth for every API fact is `docs/CONTRACTS.md` and the code in `packages/xenon/src`.

## 3. Pipeline

- **Route**: `src/app/docs/[[...slug]]/page.tsx`, `generateStaticParams` from `nav.ts`, `dynamicParams = false`
  (an unknown path is a 404, never a runtime compile). `generateMetadata` from frontmatter.
- **Loader** (`source.ts`, server-only): reads the `.mdx`, splits a small frontmatter block, compiles with
  `@mdx-js/mdx` (`remark-gfm`; Shiki for code, run at build so no highlighter ships to the browser), adds `id`s to
  h2/h3, and returns `{ frontmatter, Content, toc, prev, next, editUrl }`.
- **Frontmatter** (all a page may have):
  ```yaml
  ---
  title: Drafts and publishing        # required, sentence case, no trailing period
  description: One sentence, ≤ 160 chars, used for <meta> and search.   # required
  ---
  ```
- **TOC**: h2 and h3 only. Every page starts at h2 (the h1 is the frontmatter title, rendered by the layout).
- **Edit link**: `https://github.com/Grenish/xenon/edit/main/apps/web/content/docs/<path>.mdx`.

## 4. The MDX vocabulary (contract for content)

Content uses Markdown plus **only** these components. Anything else fails the gate.

| write | renders |
|-------|---------|
| ```` ```ts title="src/xenon.config.ts" ```` | code block with a file-name bar, copy button; `{3-5}` after the lang highlights lines |
| ```` ```bash ```` | terminal block (prompt glyph, copy without the `$`) |
| `<Install pkg="xenon-cms" />` | bun / npm / pnpm / yarn tabs, remembers the reader's choice across pages |
| `<Tabs items={["App Router", "Pages"]}>` + `<Tab>` | tabs; tab choice synced site-wide by label |
| `<Callout>` / `<Callout tone="warning">` | an aside; `tone`: `note` (default), `warning` |
| `<Steps>` wrapping `###` headings | numbered steps on a rail |
| `<Cards>` + `<Card href="/docs/…" title="…">` | "next" links, used only at the foot of a page |

Plain Markdown tables are the API tables (option · type · default · notes). No raw HTML, no images except
from `public/docs/`, no emoji.

## 5. Layout

Void ground, paper text, glow accents, IBM Plex Sans; same 4px-max radii and button shape as the landing page.

- **Top bar**: logo → `/`, "Docs", search trigger (⌘K), GitHub.
- **Left**: section tree from `nav.ts`, current page marked; sticky, scrolls on its own.
- **Centre**: title, description, article at ~68ch, then prev / next and "Edit this page".
- **Right**: "On this page", scroll-spied. Hidden under 1280px.
- **Mobile**: sidebar becomes a sheet behind a "Menu" button in the top bar; "On this page" becomes a disclosure
  above the article.
- No decorative shaders on docs pages: they're for reading.

## 6. The gate (`bun run docs:check`)

Fails when: a `nav.ts` entry has no file, or a file isn't in `nav.ts`; frontmatter is missing or over length; a page
uses an h1 or a component outside §4; an internal `/docs/…` link or `#anchor` doesn't resolve; a code fence has no
language. Gemini runs it after every batch of pages; it also runs before `next build`.

## 7. Search

Built at build time, no service, no dependency. `search.json` (force-static route) holds one record per h2/h3
section: `{ url, page, heading, text }`. The ⌘K dialog fetches it on first open, ranks with token prefix matching
(title > heading > text), keyboard-only friendly, recent queries kept in `localStorage`.

## 8. Dependencies (installed)

Approved by the coordinator and installed exact-pinned by astra in `apps/web`: `@mdx-js/mdx@3.1.1`,
`remark-gfm@4.0.1`, `shiki@4.6.0`, `server-only@0.0.1`, dev `@types/mdx@2.0.14`. Frontmatter, heading ids, TOC and
search are hand-written. Any further package goes to the coordinator first.

## 9. Status (2026-11-19)

| step | owner | state |
|------|-------|-------|
| Sitemap, loader, routes, metadata, `search.json`, `docs:check` gate (`build` runs it before `next build`) | astra | done: 27 routes 200, unknown routes 404, 171 search records each matching a rendered heading id, 54 links checked |
| Shell (top bar, sidebar, mobile sheet), DocArticle, Toc scroll spy, ⌘K search dialog, §4 components, `docs.css` | Opus | done; desktop + 390px checked, no page-level horizontal scroll |
| Content: all 27 pages | Gemini | written and reviewed against `packages/xenon/src`; CONTRACTS.md updated where it lagged the code |
| Landing page `DOCS` link → `/docs` | Opus | done |

Open: nothing. API gaps found later go to the coordinator, not into the docs.
