#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Shared with `xenon-cms init`; `bun build` inlines it, so the published package stays dependency-free.
import * as ui from "../../xenon/src/cli/ui";
import pkg from "../package.json" with { type: "json" };
import {
  type DatabaseChoice,
  getStarterTemplate,
  listStarterTemplateIds,
  type PackageManager,
  STARTER_TEMPLATES,
} from "./templates";

function help(): string {
  return ui.formatHelp({
    title: "create-xenon-app",
    version: pkg.version,
    description: "Create a new project with XenonCMS already set up.",
    usage: ["npm create xenon-app@latest [directory] [options]", "bun create xenon-app [directory] [options]"],
    options: [
      ["-t, --template <id>", `Starter template (${listStarterTemplateIds().join(", ")})`],
      ["-d, --db <adapter>", "Database adapter: pglite or postgres"],
      ["    --src-dir", "Put the app code in src/ (default)"],
      ["    --no-src-dir", "Put app/ and xenon.config.ts at the project root"],
      ["    --pm <manager>", "Package manager: bun, pnpm, yarn or npm"],
      ["-y, --yes", "Skip prompts and accept the defaults"],
      ["    --force", "Write into a directory that isn't empty"],
      ["    --dry-run", "Show the files without writing anything"],
      ["    --no-install", "Don't install dependencies"],
      ["-h, --help", "Show this help"],
    ],
    examples: ["npm create xenon-app@latest my-site", "npm create xenon-app@latest my-site -- --db postgres --yes"],
  });
}

const DB_LABELS: Record<DatabaseChoice, { label: string; hint: string }> = {
  pglite: { label: "PGlite", hint: "embedded Postgres, zero setup" },
  postgres: { label: "PostgreSQL", hint: "connects with DATABASE_URL" },
};

export interface CreateOptions {
  targetDir?: string;
  cwd?: string;
  template?: string;
  db?: DatabaseChoice;
  pm?: PackageManager;
  /** `true`: code under `src/`; `false`: `app/` at the project root. Asked interactively when omitted. */
  srcDir?: boolean;
  yes?: boolean;
  force?: boolean;
  dryRun?: boolean;
  install?: boolean;
  log?: (line: string) => void;
}

export interface CreateResult {
  targetDir: string;
  projectName: string;
  packageName: string;
  template: string;
  db: DatabaseChoice;
  pm: PackageManager;
  srcDir: boolean;
  files: string[];
  installed: boolean;
}

export function toPackageName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|-+$/g, "");
  return cleaned || "xenon-app";
}

function detectDefaultPm(): PackageManager {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("bun/")) return "bun";
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("yarn/")) return "yarn";
  return "npm";
}

function isDirNonEmpty(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((entry) => entry !== ".git" && entry !== ".DS_Store");
}

export async function createXenonApp(options: CreateOptions = {}): Promise<CreateResult> {
  const baseCwd = resolve(options.cwd ?? process.cwd());
  const log = options.log ?? ((line: string) => console.log(line));
  const interactive = !options.yes && ui.isInteractive();

  let dirArg = options.targetDir;
  let template = options.template ? getStarterTemplate(options.template) : undefined;
  if (options.template && !template) {
    throw new Error(`Unknown template "${options.template}". Available templates: ${listStarterTemplateIds().join(", ")}.`);
  }
  let db: DatabaseChoice | undefined = options.db;
  let srcDir: boolean | undefined = options.srcDir;
  const pm: PackageManager = options.pm ?? detectDefaultPm();

  log(ui.intro("create-xenon-app", pkg.version));
  if (interactive) {
    if (dirArg) log(ui.answer("Directory", dirArg));
    else {
      dirArg = await ui.text({
        label: "Directory",
        message: "Where should the project go?",
        defaultValue: "my-xenon-app",
        validate: (value) => (!options.force && isDirNonEmpty(resolve(baseCwd, value)) ? `"${value}" isn't empty. Pick another name or pass --force.` : undefined),
      });
    }
    if (template) log(ui.answer("Template", template.label));
    else if (STARTER_TEMPLATES.length === 1) {
      template = STARTER_TEMPLATES[0]!;
      log(ui.answer("Template", template.label));
    } else {
      const id = await ui.select({
        label: "Template",
        message: "Which framework?",
        choices: STARTER_TEMPLATES.map((t) => ({ value: t.id, label: t.label, hint: t.description })),
        initial: "next",
      });
      template = getStarterTemplate(id);
    }
    if (srcDir !== undefined) log(ui.answer("Layout", srcDir ? "src/ directory" : "Root app/ directory"));
    else {
      const layout = await ui.select<"src" | "root">({
        label: "Layout",
        message: "Where should the app code live?",
        choices: [
          { value: "src", label: "src/ directory", hint: "src/app, src/xenon.config.ts" },
          { value: "root", label: "Root app/ directory", hint: "app/, xenon.config.ts at the project root" },
        ],
        initial: "src",
      });
      srcDir = layout === "src";
    }
    if (db) log(ui.answer("Database", DB_LABELS[db].label));
    else {
      db = await ui.select<DatabaseChoice>({
        label: "Database",
        message: "Which database should Xenon use?",
        choices: (["pglite", "postgres"] as const).map((value) => ({ value, label: DB_LABELS[value].label, hint: DB_LABELS[value].hint })),
        initial: "pglite",
      });
    }
  }

  dirArg ??= "my-xenon-app";
  template ??= STARTER_TEMPLATES[0]!;
  db ??= "pglite";
  srcDir ??= true;
  if (!interactive) log(`  ${ui.c.dim(`${template.label} · ${DB_LABELS[db].label} · ${srcDir ? "src/ directory" : "root app/ directory"} · ${pm}`)}`);

  const targetDir = resolve(baseCwd, dirArg);
  if (!options.dryRun && !options.force && isDirNonEmpty(targetDir)) {
    throw new Error(`"${dirArg}" isn't empty. Choose another directory, or pass --force to write into it.`);
  }

  const projectName = basename(targetDir);
  const packageName = toPackageName(projectName);
  const { files, nextSteps } = template.generate({ projectName, packageName, db, pm, srcDir });

  if (!options.dryRun) {
    mkdirSync(targetDir, { recursive: true });
    for (const file of files) {
      const fullPath = join(targetDir, file.path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.content, "utf8");
    }
  }

  log(ui.heading(options.dryRun ? "Planned files" : "Files"));
  for (const line of ui.fileRows(files.map((f) => ({ path: f.path, action: "created" as const })), { verbs: false })) log(line);
  log("");

  let installed = false;
  if (!options.dryRun && options.install !== false) {
    const task = await ui.runTask(pm, ["install"], {
      cwd: targetDir,
      message: `Installing dependencies with ${pm}`,
      done: (ms) => `Installed dependencies ${ui.c.dim(ui.formatDuration(ms))}`,
      failed: `Couldn't install dependencies with ${pm}`,
    });
    installed = task.ok;
  }

  const shown = relative(baseCwd, targetDir) || ".";
  log(options.dryRun ? ui.success(`Dry run complete. ${ui.c.dim("Nothing was written.")}`) : ui.success(`Created ${ui.c.bold(projectName)}`));
  const next: string[] = [];
  if (shown !== ".") next.push(ui.cmd(`cd ${/\s/.test(shown) ? JSON.stringify(shown) : shown}`));
  if (!installed) next.push(ui.cmd(`${pm} install`));
  next.push(...nextSteps.map((step) => (/^(npm|pnpm|yarn|bun) /.test(step) ? ui.cmd(step) : step)));
  log(ui.heading("Next steps"));
  for (const line of ui.steps(next)) log(line);
  log("");

  return {
    targetDir,
    projectName,
    packageName,
    template: template.id,
    db,
    pm,
    srcDir,
    files: files.map((f) => f.path),
    installed,
  };
}

export function parseCreateArgs(argv: readonly string[]): CreateOptions & { help: boolean } {
  const opts: CreateOptions & { help: boolean } = { help: false, install: true };
  const nextValue = (i: number, flag: string): string => {
    const val = argv[i + 1];
    if (!val || val.startsWith("-")) throw new Error(`Missing value for ${flag}.`);
    return val;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "-y" || arg === "--yes") opts.yes = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-install") opts.install = false;
    else if (arg === "--src-dir") opts.srcDir = true;
    else if (arg === "--no-src-dir") opts.srcDir = false;
    else if (arg === "-t" || arg === "--template") { opts.template = nextValue(i, arg); i++; }
    else if (arg.startsWith("--template=")) opts.template = arg.slice("--template=".length);
    else if (arg === "-d" || arg === "--db") {
      const val = nextValue(i, arg);
      if (val !== "pglite" && val !== "postgres") throw new Error(`Invalid --db "${val}". Use "pglite" or "postgres".`);
      opts.db = val;
      i++;
    } else if (arg.startsWith("--db=")) {
      const val = arg.slice("--db=".length);
      if (val !== "pglite" && val !== "postgres") throw new Error(`Invalid --db "${val}". Use "pglite" or "postgres".`);
      opts.db = val;
    } else if (arg === "--pm") {
      const val = nextValue(i, arg);
      if (!["bun", "pnpm", "yarn", "npm"].includes(val)) throw new Error(`Invalid --pm "${val}".`);
      opts.pm = val as PackageManager;
      i++;
    } else if (arg.startsWith("--pm=")) {
      const val = arg.slice("--pm=".length);
      if (!["bun", "pnpm", "yarn", "npm"].includes(val)) throw new Error(`Invalid --pm "${val}".`);
      opts.pm = val as PackageManager;
    } else if (arg.startsWith("-")) throw new Error(`Unknown option "${arg}". Run "create-xenon-app --help" for usage.`);
    else if (!opts.targetDir) opts.targetDir = arg;
    else throw new Error(`Unexpected argument "${arg}".`);
  }
  return opts;
}

export async function runCreateCli(argv: readonly string[]): Promise<number> {
  try {
    const parsed = parseCreateArgs(argv);
    if (parsed.help) {
      console.log(help());
      return 0;
    }
    await createXenonApp(parsed);
    return 0;
  } catch (err) {
    if (err instanceof ui.CancelledError) {
      console.error(`\n  ${ui.c.dim("Cancelled. Nothing was written.")}\n`);
      return 130;
    }
    console.error(ui.failure(err instanceof Error ? err.message : String(err)));
    return 1;
  }
}

function isDirectRun(): boolean {
  if (typeof process === "undefined" || !process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  runCreateCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
