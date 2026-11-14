# XenonCMS — Agent Guide

XenonCMS (`xenon-cms`) is a lightweight, code-first, Next.js-native headless CMS.
Bun workspace monorepo:

- `packages/xenon` — the publishable npm package `xenon-cms` (built with tsup, ESM only).
- `apps/playground` — Next.js 16 App Router app consuming `xenon-cms` via `workspace:*`.

## Multi-agent collaboration (READ FIRST)

Several AI agents work in this repo **at the same time, in the same working tree**.

- **Coordinator:** Claude (T3 thread `e60b1e18-f287-4562-ba12-bd7b5a95b12a`). The coordinator
  assigns tasks, owns the task board, and is the only one who changes shared contracts.
- **Task board & file ownership:** `docs/COORDINATION.md`. Only edit files inside the paths
  you are assigned there. Need a change elsewhere? Message the coordinator instead.
- **Public API contract:** `docs/CONTRACTS.md`. Build/test against it; don't change it unilaterally.
- **Decisions log:** `docs/DECISIONS.md`.

### If you are a newly arriving agent
1. Read this file, `docs/COORDINATION.md`, `docs/CONTRACTS.md`.
2. Do **not** edit anything yet. Send the coordinator a message (`t3_thread_send` to the
   coordinator thread above) with your thread id, provider/model, and what you're good at.
3. Wait for an assignment, which will name your owned paths, interfaces, and done criteria.

### Shared-working-tree rules
- No `git commit`, `git checkout/switch`, `git stash`, `git reset`, `git clean`, or branch
  creation unless the coordinator explicitly says so — other agents have uncommitted work here.
- `bun install` / adding dependencies touches the shared `bun.lock`: only do it inside a task
  that explicitly allows it, and report the exact packages you added.
- Never delete or rewrite files you don't own. Prefer `trash` over `rm`.
- When done (or blocked), report back to the coordinator thread: files changed, commands run
  and their results, open questions. Be faithful about failures.

## Commands

```bash
bun install                 # install workspace deps
bun run build               # build xenon-cms (tsup)
bun run dev                 # tsup --watch for xenon-cms
bun run test                # bun test in packages/xenon
bun run typecheck           # tsc --noEmit across workspaces
bun run playground          # next dev in apps/playground
```

## Conventions
- TypeScript strict, `verbatimModuleSyntax` (use `import type`), ESM only.
- Zod v4 (`import { z } from "zod"`). Tests: `bun:test`. Type tests: `*.test-d.ts`, checked by `tsc`.
- Server-only code must never be imported from `"use client"` modules.
- Dates cross the wire as ISO-8601 strings.
- Auth is BetterAuth (user preference) — don't introduce other auth libraries.
