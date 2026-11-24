# create-xenon-app

Scaffold a new [XenonCMS](https://github.com/Grenish/xenon) project with zero setup.

## Usage

```bash
bunx create-xenon-app my-site
# or
npx create-xenon-app my-site
```

### Options

- `-t, --template <next>` — Starter framework template (pluggable; additional frameworks arrive alongside `xenon-cms/http`)
- `-d, --db <pglite | postgres>` — Embedded PGlite (zero setup) or PostgreSQL via `DATABASE_URL`
- `--pm <bun | pnpm | yarn | npm>` — Package manager
- `-y, --yes` — Accept defaults non-interactively
- `--dry-run` — Preview planned files without writing to disk
- `--no-install` — Skip dependency installation

To add XenonCMS to an existing project instead, run:

```bash
npx xenon-cms init
```
