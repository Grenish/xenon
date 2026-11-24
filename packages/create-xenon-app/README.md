# create-xenon-app

Scaffold a new Next.js project with [XenonCMS](https://github.com/Grenish/xenon) already set up: config, database, API route and admin page.

[![npm](https://img.shields.io/npm/v/create-xenon-app)](https://www.npmjs.com/package/create-xenon-app)
[![npm downloads](https://img.shields.io/npm/dm/create-xenon-app)](https://www.npmjs.com/package/create-xenon-app)
[![CI](https://github.com/Grenish/xenon/actions/workflows/ci.yml/badge.svg)](https://github.com/Grenish/xenon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Grenish/xenon/blob/main/LICENSE)

## Usage

```bash
npm create xenon-app@latest my-site
```

The other package managers work too:

```bash
bun create xenon-app my-site
pnpm create xenon-app my-site
yarn create xenon-app my-site
npx create-xenon-app my-site
```

Without `--yes`, the scaffolder asks for anything you didn't pass as a flag: the directory, the framework, the layout (`src/` or root) and the database.

When it finishes, it prints the next steps. For PGlite the app runs with no setup:

```bash
cd my-site
npm run dev
```

Open <http://localhost:3000/admin> and create the first admin account.

## Options

| flag | what it does |
| --- | --- |
| `-t, --template <id>` | Starter template. `next` is the only one for now. |
| `-d, --db <adapter>` | `pglite` (embedded database, zero setup) or `postgres` (set `DATABASE_URL` in `.env`; the scaffold's next steps say so). |
| `--src-dir` | Put the app code in `src/` (default). |
| `--no-src-dir` | Put `app/` and `xenon.config.ts` at the project root. |
| `--pm <manager>` | Package manager to install with: `bun`, `pnpm`, `yarn` or `npm`. |
| `-y, --yes` | Skip the prompts and accept the defaults. |
| `--force` | Write into a directory that isn't empty. |
| `--dry-run` | Show the files that would be written, without writing anything. |
| `--no-install` | Don't install dependencies. |
| `-h, --help` | Show the help. |

### Examples

```bash
# PostgreSQL, defaults for everything else, no prompts
npm create xenon-app@latest my-site -- --db postgres --yes

# App at the project root instead of src/, with pnpm
npm create xenon-app@latest my-site -- --no-src-dir --pm pnpm

# See the files without creating anything
npm create xenon-app@latest my-site -- --dry-run
```

The `--` separator is only needed with `npm create`. `bun create` and `npx` take the options directly after the directory name.

## Adding XenonCMS to an existing project

Use [`xenon-cms`](https://www.npmjs.com/package/xenon-cms) instead:

```bash
npx xenon-cms init
```

## License

MIT
