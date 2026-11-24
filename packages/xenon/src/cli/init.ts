import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { detectTemplate, getTemplate, listTemplateIds, TEMPLATES } from "./templates";
import {
  detectProjectContext,
  formatInstallCommand,
  hasDependency,
  installArgs,
  normalizeRoutePath,
} from "./templates/shared";
import type { DatabaseChoice, FrameworkTemplate, GeneratedFile, PackageManager } from "./templates/types";
import * as ui from "./ui";

declare const __XENON_VERSION__: string | undefined;
const VERSION = typeof __XENON_VERSION__ === "string" ? __XENON_VERSION__ : "0.0.0";

const DB_LABELS: Record<DatabaseChoice, { label: string; hint: string }> = {
  pglite: { label: "PGlite", hint: "embedded Postgres, zero setup" },
  postgres: { label: "PostgreSQL", hint: "connects with DATABASE_URL" },
};

export interface InitOptions {
  cwd?: string;
  framework?: string;
  db?: DatabaseChoice;
  adminPath?: string;
  apiPath?: string;
  yes?: boolean;
  force?: boolean;
  dryRun?: boolean;
  install?: boolean;
  /** Optional template registry override (for extensibility and tests). */
  templates?: readonly FrameworkTemplate[];
  /** Optional custom logger (defaults to stdout). */
  log?: (line: string) => void;
}

export interface FileAction {
  path: string;
  action: "created" | "updated" | "skipped";
}

export interface InitResult {
  cwd: string;
  framework: string;
  db: DatabaseChoice;
  pm: PackageManager;
  adminPath: string;
  apiPath: string;
  files: FileAction[];
  missingDependencies: string[];
  installedDependencies: boolean;
  notes: string[];
}

function appendMissingLines(existing: string, addition: string): { next: string; changed: boolean } {
  const existingLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const toAdd = addition
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !existingLines.has(line.trim()));
  if (toAdd.length === 0) return { next: existing, changed: false };
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  return { next: `${existing}${sep}${toAdd.join("\n")}\n`, changed: true };
}

export function applyGeneratedFiles(
  cwd: string,
  files: readonly GeneratedFile[],
  options: { force?: boolean; dryRun?: boolean } = {},
): FileAction[] {
  const actions: FileAction[] = [];
  for (const file of files) {
    const fullPath = join(cwd, file.path);
    const exists = existsSync(fullPath);
    if (file.mode === "append-lines" && exists) {
      const current = readFileSync(fullPath, "utf8");
      const { next, changed } = appendMissingLines(current, file.content);
      if (!changed) {
        actions.push({ path: file.path, action: "skipped" });
        continue;
      }
      if (!options.dryRun) writeFileSync(fullPath, next, "utf8");
      actions.push({ path: file.path, action: "updated" });
      continue;
    }

    if (exists && !options.force) {
      actions.push({ path: file.path, action: "skipped" });
      continue;
    }

    if (!options.dryRun) {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.content, "utf8");
    }
    actions.push({ path: file.path, action: exists ? "updated" : "created" });
  }
  return actions;
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const log = options.log ?? ((line: string) => console.log(line));
  const templates = options.templates ?? TEMPLATES;
  const ctx = detectProjectContext(cwd);
  const detected = detectTemplate(ctx, templates);

  const interactive = !options.yes && ui.isInteractive();
  const detectedScore = detected.detect(ctx);

  let template = options.framework ? getTemplate(options.framework) : undefined;
  if (options.framework && !template) {
    throw new Error(
      `Unknown framework "${options.framework}". Available frameworks: ${listTemplateIds().join(", ")}.`,
    );
  }

  let db: DatabaseChoice | undefined = options.db;
  if (interactive) log(ui.intro("init", VERSION));

  if (interactive && !template) {
    if (TEMPLATES.length === 1 || detectedScore >= 90) {
      template = detected;
      log(ui.answer("Framework", detected.label, detectedScore > 0 ? "detected" : undefined));
    } else {
      const chosenId = await ui.select({
        label: "Framework",
        message: "Which framework does this project use?",
        choices: TEMPLATES.map((t) => ({ value: t.id, label: t.label, hint: t.description })),
        initial: detected.id,
      });
      template = getTemplate(chosenId) ?? detected;
    }
  } else if (interactive && template) {
    log(ui.answer("Framework", template.label));
  }
  if (interactive && !db) {
    db = await ui.select<DatabaseChoice>({
      label: "Database",
      message: "Which database should Xenon use?",
      choices: (["pglite", "postgres"] as const).map((value) => ({ value, label: DB_LABELS[value].label, hint: DB_LABELS[value].hint })),
      initial: "pglite",
    });
  } else if (interactive && db) {
    log(ui.answer("Database", DB_LABELS[db].label));
  }

  template ??= detected;
  db ??= "pglite";

  const adminPath = normalizeRoutePath(options.adminPath ?? "/admin", "/admin");
  const apiPath = normalizeRoutePath(options.apiPath ?? "/api/xenon", "/api/xenon");

  const generated = template.generate(ctx, { db, adminPath, apiPath });
  const files = applyGeneratedFiles(cwd, generated.files, {
    force: options.force,
    dryRun: options.dryRun,
  });

  const missingDependencies = generated.dependencies.filter((dep) => !hasDependency(ctx.pkg, dep));
  const summary = `${template.label} · ${DB_LABELS[db].label}`;
  if (!interactive) log(ui.intro(options.dryRun ? "init (dry run)" : "init", VERSION) + `  ${ui.c.dim(summary)}`);
  if (detectedScore === 0 && !options.framework) {
    log(ui.warning(`No ${template.label} project detected here, so the files below assume one.`));
  }

  log(ui.heading(options.dryRun ? "Planned changes" : "Files"));
  for (const line of ui.fileRows(files, { dryRun: options.dryRun })) log(line);
  const skipped = files.filter((f) => f.action === "skipped").length;
  if (skipped > 0 && !options.force) log(`    ${ui.c.dim(`${skipped} ${skipped === 1 ? "file was" : "files were"} left unchanged. Use --force to overwrite.`)}`);
  log("");

  let installedDependencies = false;
  if (!options.dryRun && options.install !== false && missingDependencies.length > 0 && ctx.pkg !== null) {
    const [bin, args] = installArgs(ctx.pm, missingDependencies);
    const task = await ui.runTask(bin, args, {
      cwd,
      message: `Installing ${missingDependencies.join(", ")} with ${ctx.pm}`,
      done: (ms) => `Installed ${missingDependencies.join(", ")} ${ui.c.dim(ui.formatDuration(ms))}`,
      failed: `Couldn't install dependencies with ${ctx.pm}`,
    });
    installedDependencies = task.ok;
  }

  const next: string[] = [];
  if (missingDependencies.length > 0 && !installedDependencies) next.push(ui.cmd(formatInstallCommand(ctx.pm, missingDependencies)));
  next.push(...generated.notes);
  if (options.dryRun) {
    log(ui.success(`Dry run complete. ${ui.c.dim("Nothing was written.")}`));
  } else {
    log(ui.success(`Xenon is set up in ${ui.c.bold(template.label)}`));
  }
  if (next.length > 0) {
    log(ui.heading("Next steps"));
    for (const line of ui.steps(next)) log(line);
  }
  log("");

  return {
    cwd,
    framework: template.id,
    db,
    pm: ctx.pm,
    adminPath,
    apiPath,
    files,
    missingDependencies,
    installedDependencies,
    notes: generated.notes,
  };
}
