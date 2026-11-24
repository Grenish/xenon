import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCliArgs, runCli } from "../../src/cli/index";
import { runInit } from "../../src/cli/init";
import { detectTemplate, getTemplate } from "../../src/cli/templates";
import { detectProjectContext } from "../../src/cli/templates/shared";
import type { FrameworkTemplate } from "../../src/cli/templates/types";

const dirs: string[] = [];
function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "xenon-init-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("xenon-cms CLI argument parsing", () => {
  test("parses init command and options cleanly", () => {
    const parsed = parseCliArgs([
      "init",
      "--framework", "next",
      "--db=postgres",
      "--dir", "/tmp/demo",
      "--admin-path", "/cms",
      "--api-path=/api/cms",
      "--yes",
      "--force",
      "--dry-run",
      "--no-install",
    ]);
    expect(parsed).toEqual({
      command: "init",
      help: false,
      version: false,
      framework: "next",
      db: "postgres",
      dir: "/tmp/demo",
      adminPath: "/cms",
      apiPath: "/api/cms",
      yes: true,
      force: true,
      dryRun: true,
      install: false,
    });
  });

  test("rejects unknown options and invalid --db values", () => {
    expect(() => parseCliArgs(["init", "--db", "sqlite"])).toThrow(/Invalid --db/);
    expect(() => parseCliArgs(["init", "--bogus"])).toThrow(/Unknown option/);
    expect(() => parseCliArgs(["init", "--framework"])).toThrow(/Missing value/);
  });
});

describe("xenon-cms init framework detection and scaffolding", () => {
  test("auto-detects Next.js with src/app and @/* alias and generates wired files", async () => {
    const dir = makeTempProject();
    mkdirSync(join(dir, "src", "app"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-next-app", dependencies: { next: "16.4.6", react: "19.3.1" } }));
    writeFileSync(join(dir, "tsconfig.json"), `{\n  // comment\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } }\n}`);
    writeFileSync(join(dir, "bun.lock"), "");
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");

    const ctx = detectProjectContext(dir);
    expect(ctx.pm).toBe("bun");
    expect(ctx.hasSrcDir).toBe(true);
    expect(ctx.atAliasDir).toBe("src");
    expect(detectTemplate(ctx).id).toBe("next");

    const logs: string[] = [];
    const res = await runInit({ cwd: dir, yes: true, install: false, log: (l) => logs.push(l) });
    expect(res.framework).toBe("next");
    expect(res.db).toBe("pglite");
    expect(res.missingDependencies).toEqual(["xenon-cms", "@electric-sql/pglite"]);

    const configSrc = readFileSync(join(dir, "src/xenon.config.ts"), "utf8");
    expect(configSrc).toContain('import { pgliteAdapter } from "xenon-cms/pglite"');
    expect(configSrc).toContain('dataDir: ".xenon/pgdata"');

    const apiSrc = readFileSync(join(dir, "src/app/api/xenon/[...slug]/route.ts"), "utf8");
    expect(apiSrc).toContain('import config from "@/xenon.config"');
    expect(apiSrc).toContain("createApiHandler(config)");

    const adminSrc = readFileSync(join(dir, "src/app/admin/[[...segments]]/page.tsx"), "utf8");
    expect(adminSrc).toContain('import "xenon-cms/styles.css"');
    expect(adminSrc).toContain('import config from "@/xenon.config"');
    expect(adminSrc).toContain("runAdminAction(config, input)");

    const nextConfigSrc = readFileSync(join(dir, "next.config.ts"), "utf8");
    expect(nextConfigSrc).toContain('serverExternalPackages: ["@electric-sql/pglite"]');

    const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain(".xenon/");

    // Running again without --force skips existing files and does not duplicate .gitignore lines
    const second = await runInit({ cwd: dir, yes: true, install: false, log: () => {} });
    expect(second.files.every((f) => f.action === "skipped")).toBe(true);
    expect(readFileSync(join(dir, ".gitignore"), "utf8").match(/\.xenon\//g)?.length).toBe(1);
  });

  test("computes relative imports when tsconfig has no @/* alias and notes next.config.ts patch when existing", async () => {
    const dir = makeTempProject();
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "plain-next", dependencies: { next: "16.4.6" } }));
    writeFileSync(join(dir, "next.config.ts"), "export default {};\n");
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");

    const res = await runInit({
      cwd: dir,
      db: "pglite",
      adminPath: "/cms",
      apiPath: "/api/cms",
      yes: true,
      install: false,
      log: () => {},
    });
    expect(res.pm).toBe("pnpm");
    expect(res.notes.some((n) => n.includes("next.config.ts") && n.includes("@electric-sql/pglite"))).toBe(true);

    const apiSrc = readFileSync(join(dir, "app/api/cms/[...slug]/route.ts"), "utf8");
    expect(apiSrc).toContain('import config from "../../../../xenon.config"');

    const configSrc = readFileSync(join(dir, "xenon.config.ts"), "utf8");
    expect(configSrc).toContain('admin: { path: "/cms" }');
    expect(configSrc).toContain('api: { path: "/api/cms" }');
  });

  test("supports pluggable custom framework templates, postgres mode, and --dry-run", async () => {
    const dir = makeTempProject();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "astro-demo", dependencies: { astro: "5.0.0" } }));

    const customAstro: FrameworkTemplate = {
      id: "astro",
      label: "Astro",
      description: "Astro test template",
      detect: (ctx) => (ctx.pkg && "dependencies" in ctx.pkg ? 95 : 0),
      generate: (_ctx, opts) => ({
        files: [{ path: "src/xenon.config.ts", content: `export const db = ${JSON.stringify(opts.db)};\n` }],
        dependencies: ["xenon-cms", opts.db === "postgres" ? "postgres" : "@electric-sql/pglite"],
        notes: ["Start Astro dev server."],
      }),
    };

    const dry = await runInit({
      cwd: dir,
      db: "postgres",
      yes: true,
      dryRun: true,
      install: false,
      templates: [customAstro],
      log: () => {},
    });
    expect(dry.framework).toBe("astro");
    expect(dry.db).toBe("postgres");
    expect(dry.missingDependencies).toEqual(["xenon-cms", "postgres"]);
    expect(existsSync(join(dir, "src/xenon.config.ts"))).toBe(false);

    const applied = await runInit({
      cwd: dir,
      db: "postgres",
      yes: true,
      install: false,
      templates: [customAstro],
      log: () => {},
    });
    expect(applied.files).toEqual([{ path: "src/xenon.config.ts", action: "created" }]);
    expect(readFileSync(join(dir, "src/xenon.config.ts"), "utf8")).toContain('"postgres"');
    expect(getTemplate("nextjs")?.id).toBe("next");
  });

  test("runCli help advertises npx xenon-cms init (not unrelated xenon) and handles version/errors", async () => {
    const originalLog = console.log;
    const originalErr = console.error;
    const out: string[] = [];
    const err: string[] = [];
    console.log = (...a: unknown[]) => out.push(a.join(" "));
    console.error = (...a: unknown[]) => err.push(a.join(" "));
    try {
      expect(await runCli(["--help"])).toBe(0);
      const help = out.join("\n");
      expect(help).toContain("npx xenon-cms init");
      expect(help).not.toContain("npx xenon init");
      expect(await runCli(["--version"])).toBe(0);
      expect(await runCli(["nope"])).toBe(1);
      expect(err.join("\n")).toContain('Unknown command "nope"');
    } finally {
      console.log = originalLog;
      console.error = originalErr;
    }
  });

  test("generated Next.js files typecheck cleanly against built xenon-cms (both src/app and root app layouts)", async () => {
    const pkgRoot = resolve(import.meta.dir, "../..");
    const distIndex = join(pkgRoot, "dist/index.d.ts");
    const tscBin = resolve(pkgRoot, "../../node_modules/.bin/tsc");
    if (!existsSync(distIndex) || !existsSync(tscBin)) return;

    for (const layout of ["src", "root"] as const) {
      const dir = makeTempProject();
      mkdirSync(layout === "src" ? join(dir, "src", "app") : join(dir, "app"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `tc-${layout}`, dependencies: { next: "16.4.6" } }));
      if (layout === "src") {
        writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
      }

      await runInit({ cwd: dir, framework: "next", db: "pglite", yes: true, install: false, log: () => {} });

      // Write a check tsconfig resolving xenon-cms subpaths to dist/*.d.ts and monorepo node_modules
      writeFileSync(
        join(dir, "tsconfig.check.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "esnext",
              moduleResolution: "bundler",
              jsx: "react-jsx",
              strict: true,
              skipLibCheck: true,
              noEmit: true,
              baseUrl: ".",
              typeRoots: [join(pkgRoot, "node_modules/@types"), resolve(pkgRoot, "../../node_modules/@types")],
              paths: {
                ...(layout === "src" ? { "@/*": ["./src/*"] } : {}),
                "xenon-cms": [join(pkgRoot, "dist/index.d.ts")],
                "xenon-cms/next": [join(pkgRoot, "dist/next.d.ts")],
                "xenon-cms/pglite": [join(pkgRoot, "dist/pglite.d.ts")],
                "xenon-cms/postgres": [join(pkgRoot, "dist/postgres.d.ts")],
                "xenon-cms/storage/local": [join(pkgRoot, "dist/storage/local.d.ts")],
                "xenon-cms/styles.css": [join(dir, "styles-stub.d.ts")],
                next: [join(pkgRoot, "node_modules/next")],
                "next/*": [join(pkgRoot, "node_modules/next/*")],
                react: [join(pkgRoot, "node_modules/@types/react")],
                "react/*": [join(pkgRoot, "node_modules/@types/react/*")],
              },
            },
            include: ["**/*.ts", "**/*.tsx"],
          },
          null,
          2,
        ),
      );
      writeFileSync(join(dir, "styles-stub.d.ts"), 'declare module "xenon-cms/styles.css";\n');

      const tc = spawnSync(tscBin, ["--noEmit", "-p", join(dir, "tsconfig.check.json")], {
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      if (tc.status !== 0) {
        throw new Error(`tsc failed for ${layout} layout:\n${tc.stdout}\n${tc.stderr}`);
      }
      expect(tc.status).toBe(0);
    }
  });

  test("built dist/cli.js executes end-to-end under plain Node", () => {
    const cliDist = resolve(import.meta.dir, "../../dist/cli.js");
    if (!existsSync(cliDist)) return;
    const dir = makeTempProject();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "node-smoke", dependencies: { next: "16.4.6" } }));
    const res = spawnSync(process.execPath.includes("node") ? process.execPath : "node", [
      cliDist, "init", "--dir", dir, "--framework", "next", "--db", "pglite", "--yes", "--no-install",
    ], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: undefined } });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Xenon is set up in Next.js (App Router)");
    expect(res.stdout).not.toContain("\u001B[");
    expect(existsSync(join(dir, "xenon.config.ts"))).toBe(true);
    expect(existsSync(join(dir, "app/admin/[[...segments]]/page.tsx"))).toBe(true);
  });
});
