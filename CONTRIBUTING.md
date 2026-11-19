# Contributing to XenonCMS

Thanks for helping. Before you start, please read the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you open a pull request

- **For a bug or small fix:** open a pull request directly.
- **For a new feature or a change to the public API:** open an issue first so we can agree on the
  approach. `docs/CONTRACTS.md` describes the public API; changes to it need a discussion.
- **For a security problem:** do not open a public issue. Use the private reporting described in
  [SECURITY](SECURITY.md).

## Setup

XenonCMS is a Bun workspace monorepo. You need [Bun](https://bun.sh) and a recent Node.js.

```bash
bun install
bun run build        # build xenon-cms into packages/xenon/dist
bun run playground   # Next.js playground on http://localhost:3000
```

## Checks before you push

Run these from the repository root. A pull request should pass all of them:

```bash
bun run typecheck    # tsc --noEmit across workspaces
bun run test         # bun test in packages/xenon
bun run build        # build the package
```

To run the adapter tests against a real PostgreSQL server, see the section in the root README.

If you change the web docs (`apps/web`), also run `bun run --filter web build`. It runs the docs content
check first.

## Code guidelines

- TypeScript in strict mode, ESM only, `import type` for type-only imports.
- Validation uses Zod v4 (`import { z } from "zod"`).
- Tests use `bun:test`. Type tests are `*.test-d.ts` files, checked by `tsc`.
- Server-only code must never be imported from a `"use client"` module.
- Keep changes focused. Don't reformat or refactor unrelated code in the same pull request.
- Add or update tests for behavior changes.
- Don't add a new dependency without saying why in the pull request. Auth uses BetterAuth; don't add
  another auth library.

## Commits and pull requests

- Write clear commit messages in the imperative mood, for example `Fix slug conflict on update`.
- Fill in the pull request template. Link the issue it closes, if there is one.
- Keep a pull request to one logical change. Split unrelated work into separate pull requests.
- A maintainer reviews every pull request. Respond to review comments, or say why you disagree.

## Licensing

XenonCMS is released under the [MIT License](LICENSE). By submitting a contribution, you agree that it
is licensed under the same terms.
