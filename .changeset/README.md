# Changesets

This folder holds [Changesets](https://changesets.dev): one small markdown file per user-facing change, saying
which published packages it bumps and how. The release workflow turns them into version bumps and `CHANGELOG.md`
entries, then publishes to npm.

Published packages: `xenon-cms` and `create-xenon-app` (versioned together). The apps (`playground`, `web`) are private and never versioned.

## Adding one

```bash
bun run changeset          # pick packages + bump type, write a one-line summary
```

Commit the generated `.changeset/*.md` with your PR. Skip it for changes users can't see (tests, CI, docs-only).

Bump types while we're on `0.x`: `patch` for fixes, `minor` for features **and** breaking changes (note them as
**Breaking:** in the summary). `major` is reserved for `1.0.0`.

## Releasing

Merging to `main` runs `.github/workflows/release.yml`:

1. With pending changesets, it opens (or updates) a **"Version packages"** PR that runs `changeset version`.
2. Merging that PR publishes the bumped packages to npm (`bun run release`) with provenance, and pushes git tags.

Check what's pending locally with `bun run changeset status`.
