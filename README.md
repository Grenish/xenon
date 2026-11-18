# XenonCMS

A lightweight, code-first headless CMS that lives inside your Next.js app. Define collections in
TypeScript, get typed content, a REST API and an admin UI.

This is a Bun workspace monorepo:

| path | what |
| --- | --- |
| [`packages/xenon`](packages/xenon) | the publishable npm package, `xenon-cms` — see its [README](packages/xenon/README.md) for usage |
| [`apps/playground`](apps/playground) | a Next.js 16 app that uses `xenon-cms` through the workspace (blog + admin) |

## Getting started

```bash
bun install
bun run build        # build xenon-cms into packages/xenon/dist
bun run playground   # next dev on http://localhost:3000
```

Open <http://localhost:3000/admin> and create the first admin. The playground needs no setup: it
stores content in an embedded PGlite database and uploads on disk, both under
`apps/playground/.xenon/` (git-ignored). To use a real Postgres server or set an API key, copy
`apps/playground/.env.example` to `.env`.

## Commands

```bash
bun run build        # build xenon-cms (tsup + Tailwind CLI)
bun run dev          # rebuild xenon-cms on change
bun run test         # bun test in packages/xenon
bun run typecheck    # tsc --noEmit across workspaces
bun run playground   # next dev in apps/playground
```

`bun run build` empties `dist` first, which breaks a running `next dev`. While the playground is
running, use `bun run dev`, or rebuild in place from `packages/xenon` with
`./node_modules/.bin/tsup && bun run build:css`.

To run the adapter tests against a real PostgreSQL server:

```bash
XENON_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/db bun test packages/xenon/test/adapters/postgres.test.ts
```

## License

MIT
