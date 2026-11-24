import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInit } from "./init";
import { listTemplateIds } from "./templates";
import type { DatabaseChoice } from "./templates/types";
import * as ui from "./ui";

declare const __XENON_VERSION__: string | undefined;

const VERSION = typeof __XENON_VERSION__ === "string" ? __XENON_VERSION__ : "0.0.1";

function help(): string {
  return ui.formatHelp({
    title: "CLI",
    version: VERSION,
    description: "Add XenonCMS to an existing project.",
    usage: ["npx xenon-cms init [options]", "bunx xenon-cms init [options]"],
    commands: [["init", "Add Xenon's config, API route and admin page to this project"]],
    options: [
      ["-f, --framework <id>", `Host framework (${listTemplateIds().join(", ")})`],
      ["-d, --db <adapter>", "Database adapter: pglite or postgres"],
      ["    --dir <path>", "Project directory (default: current directory)"],
      ["    --admin-path <path>", "Admin UI route (default: /admin)"],
      ["    --api-path <path>", "REST API base path (default: /api/xenon)"],
      ["-y, --yes", "Skip prompts and accept the defaults"],
      ["    --force", "Overwrite files that already exist"],
      ["    --dry-run", "Show what would change without writing anything"],
      ["    --no-install", "Don't install dependencies"],
      ["-h, --help", "Show this help"],
      ["-v, --version", "Show the version"],
    ],
    examples: ["npx xenon-cms init", "npx xenon-cms init --db postgres --yes", "npx xenon-cms init --dry-run"],
  });
}

interface ParsedArgs {
  command: string | null;
  help: boolean;
  version: boolean;
  framework?: string;
  db?: DatabaseChoice;
  dir?: string;
  adminPath?: string;
  apiPath?: string;
  yes: boolean;
  force: boolean;
  dryRun: boolean;
  install: boolean;
}

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    help: false,
    version: false,
    yes: false,
    force: false,
    dryRun: false,
    install: true,
  };

  const nextValue = (i: number, flag: string): string => {
    const val = argv[i + 1];
    if (!val || val.startsWith("-")) throw new Error(`Missing value for ${flag}.`);
    return val;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") parsed.help = true;
    else if (arg === "-v" || arg === "--version") parsed.version = true;
    else if (arg === "-y" || arg === "--yes") parsed.yes = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--no-install") parsed.install = false;
    else if (arg === "-f" || arg === "--framework") { parsed.framework = nextValue(i, arg); i++; }
    else if (arg.startsWith("--framework=")) parsed.framework = arg.slice("--framework=".length);
    else if (arg === "-d" || arg === "--db") {
      const val = nextValue(i, arg);
      if (val !== "pglite" && val !== "postgres") throw new Error(`Invalid --db "${val}". Use "pglite" or "postgres".`);
      parsed.db = val;
      i++;
    } else if (arg.startsWith("--db=")) {
      const val = arg.slice("--db=".length);
      if (val !== "pglite" && val !== "postgres") throw new Error(`Invalid --db "${val}". Use "pglite" or "postgres".`);
      parsed.db = val;
    } else if (arg === "--dir") { parsed.dir = nextValue(i, arg); i++; }
    else if (arg.startsWith("--dir=")) parsed.dir = arg.slice("--dir=".length);
    else if (arg === "--admin-path") { parsed.adminPath = nextValue(i, arg); i++; }
    else if (arg.startsWith("--admin-path=")) parsed.adminPath = arg.slice("--admin-path=".length);
    else if (arg === "--api-path") { parsed.apiPath = nextValue(i, arg); i++; }
    else if (arg.startsWith("--api-path=")) parsed.apiPath = arg.slice("--api-path=".length);
    else if (arg.startsWith("-")) throw new Error(`Unknown option "${arg}". Run "npx xenon-cms --help" for usage.`);
    else if (!parsed.command) parsed.command = arg;
    else throw new Error(`Unexpected argument "${arg}". Run "npx xenon-cms --help" for usage.`);
  }

  return parsed;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  try {
    const args = parseCliArgs(argv);
    if (args.version) {
      console.log(VERSION);
      return 0;
    }
    if (args.help || !args.command) {
      console.log(help());
      return 0;
    }
    if (args.command === "init") {
      await runInit({
        cwd: args.dir,
        framework: args.framework,
        db: args.db,
        adminPath: args.adminPath,
        apiPath: args.apiPath,
        yes: args.yes,
        force: args.force,
        dryRun: args.dryRun,
        install: args.install,
      });
      return 0;
    }
    console.error(ui.failure(`Unknown command "${args.command}".`, "Run `npx xenon-cms --help` to see the available commands."));
    return 1;
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
  runCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
