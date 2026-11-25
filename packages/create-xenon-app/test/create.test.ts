import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pkgMeta from "../package.json" with { type: "json" };
import { createXenonApp, parseCreateArgs, toPackageName } from "../src/index";
import { XENON_VERSION_RANGE } from "../src/templates";

const dirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "create-xenon-app-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("create-xenon-app", () => {
  test("parses CLI options and normalizes package names", () => {
    expect(toPackageName("My Awesome Blog!")).toBe("my-awesome-blog");
    expect(toPackageName("___")).toBe("xenon-app");
    const parsed = parseCreateArgs(["my-blog", "--template=next", "--db", "postgres", "--pm", "bun", "-y", "--no-install"]);
    expect(parsed).toMatchObject({
      targetDir: "my-blog",
      template: "next",
      db: "postgres",
      pm: "bun",
      yes: true,
      install: false,
    });
    expect(parseCreateArgs(["x", "--src-dir"]).srcDir).toBe(true);
    expect(parseCreateArgs(["x", "--no-src-dir"]).srcDir).toBe(false);
    expect(parseCreateArgs(["x"]).srcDir).toBeUndefined();
  });

  test("puts app code in src/ by default, or at the root with srcDir: false", async () => {
    const base = makeTempDir();
    const common = { cwd: base, template: "next", db: "pglite" as const, pm: "npm" as const, yes: true, install: false, log: () => {} };

    const withSrc = await createXenonApp({ ...common, targetDir: "with-src" });
    expect(withSrc.srcDir).toBe(true);
    expect(withSrc.files).toContain("src/app/page.tsx");
    expect(withSrc.files).toContain("src/xenon.config.ts");
    const srcTsconfig = JSON.parse(readFileSync(join(base, "with-src/tsconfig.json"), "utf8"));
    expect(srcTsconfig.compilerOptions.paths["@/*"]).toEqual(["./src/*"]);

    const root = await createXenonApp({ ...common, targetDir: "root-app", srcDir: false });
    expect(root.srcDir).toBe(false);
    expect(root.files).toContain("app/page.tsx");
    expect(root.files).toContain("app/api/xenon/[...slug]/route.ts");
    expect(root.files).toContain("app/admin/[[...segments]]/page.tsx");
    expect(root.files).toContain("xenon.config.ts");
    expect(root.files.some((f) => f.startsWith("src/"))).toBe(false);
    expect(existsSync(join(base, "root-app/src"))).toBe(false);
    const rootTsconfig = JSON.parse(readFileSync(join(base, "root-app/tsconfig.json"), "utf8"));
    expect(rootTsconfig.compilerOptions.paths["@/*"]).toEqual(["./*"]);
    expect(readFileSync(join(base, "root-app/lib/content.ts"), "utf8")).toContain('from "@/xenon.config"');
    // The starter's own paths follow the chosen layout.
    expect(readFileSync(join(base, "root-app/app/page.tsx"), "utf8")).toContain("<code>app/page.tsx</code>");
    expect(root.files).toEqual(expect.arrayContaining(["app/globals.css", "app/posts/[slug]/page.tsx", "lib/site.tsx", "lib/content.ts"]));
  });

  test("generated projects typecheck in both layouts against the built xenon-cms", async () => {
    const xenonRoot = resolve(import.meta.dir, "../../xenon");
    const tsc = resolve(import.meta.dir, "../../../node_modules/.bin/tsc");
    if (!existsSync(join(xenonRoot, "dist/index.d.ts")) || !existsSync(tsc)) return;
    const base = makeTempDir();
    for (const srcDir of [true, false]) {
      const name = srcDir ? "tc-src" : "tc-root";
      await createXenonApp({ cwd: base, targetDir: name, template: "next", db: "pglite", pm: "npm", srcDir, yes: true, install: false, log: () => {} });
      const project = join(base, name);
      // Stand in for `npm install`: link the workspace's builds of the dependencies the project uses.
      const modules = join(project, "node_modules");
      mkdirSync(join(modules, "@types"), { recursive: true });
      symlinkSync(xenonRoot, join(modules, "xenon-cms"), "dir");
      for (const dep of ["next", "react", "react-dom", "@electric-sql/pglite"]) {
        mkdirSync(join(modules, dep, ".."), { recursive: true });
        symlinkSync(join(xenonRoot, "node_modules", dep), join(modules, dep), "dir");
      }
      for (const types of ["react", "react-dom"]) symlinkSync(join(xenonRoot, "node_modules/@types", types), join(modules, "@types", types), "dir");
      writeFileSync(join(project, "next-env.d.ts"), '/// <reference types="next" />\ndeclare module "*.css";\n');
      const result = spawnSync(tsc, ["--noEmit", "-p", project], { encoding: "utf8", shell: process.platform === "win32" });
      if (result.status !== 0) throw new Error(`tsc failed for the ${srcDir ? "src/" : "root app/"} layout:\n${result.stdout}${result.stderr}`);
    }
  }, 120_000);

  test("scaffolds a complete Next.js + PGlite app pinned to matching xenon-cms version", async () => {
    const base = makeTempDir();
    const res = await createXenonApp({
      cwd: base,
      targetDir: "my-site",
      template: "next",
      db: "pglite",
      pm: "bun",
      yes: true,
      install: false,
      log: () => {},
    });

    expect(res.template).toBe("next");
    expect(res.packageName).toBe("my-site");
    const target = join(base, "my-site");
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["xenon-cms"]).toBe(`^${pkgMeta.version}`);
    expect(pkg.dependencies["xenon-cms"]).toBe(XENON_VERSION_RANGE);
    expect(pkg.dependencies["@electric-sql/pglite"]).toBeDefined();
    expect(pkg.dependencies.next).toBeDefined();
    expect(readFileSync(join(target, "next.config.ts"), "utf8")).toContain('serverExternalPackages: ["@electric-sql/pglite"]');
    expect(readFileSync(join(target, "src/app/admin/[[...segments]]/page.tsx"), "utf8")).toContain("runAdminAction");
    expect(readFileSync(join(target, "src/app/api/xenon/[...slug]/route.ts"), "utf8")).toContain("createApiHandler");
    expect(readFileSync(join(target, "src/app/page.tsx"), "utf8")).toContain("getXenon(config).find");
    const home = readFileSync(join(target, "src/app/page.tsx"), "utf8");
    expect(home).toContain("<code>src/app/page.tsx</code>");
    expect(home).toContain("await connection()"); // rendered per request, not frozen at build time
    expect(readFileSync(join(target, "src/lib/site.tsx"), "utf8")).toContain("https://xenon.grenishrai.pro/docs");
  });

  test("scaffolds a Next.js + Postgres app using postgres ^4.1.1 without pglite config", async () => {
    const base = makeTempDir();
    const res = await createXenonApp({
      cwd: base,
      targetDir: "pg-site",
      template: "nextjs",
      db: "postgres",
      pm: "pnpm",
      yes: true,
      install: false,
      log: () => {},
    });

    expect(res.template).toBe("next");
    const target = join(base, "pg-site");
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.postgres).toBe("^4.1.1");
    expect(pkg.dependencies["@electric-sql/pglite"]).toBeUndefined();
    expect(readFileSync(join(target, "src/xenon.config.ts"), "utf8")).toContain("postgresAdapter");
    expect(readFileSync(join(target, "next.config.ts"), "utf8")).not.toContain("@electric-sql/pglite");
  });

  test("refuses non-empty target directory unless --force, and honors --dry-run", async () => {
    const base = makeTempDir();
    const existing = join(base, "taken");
    mkdirSync(existing);
    writeFileSync(join(existing, "README.md"), "hi");

    await expect(
      createXenonApp({ cwd: base, targetDir: "taken", yes: true, install: false, log: () => {} }),
    ).rejects.toThrow(/isn't empty/);

    const dry = await createXenonApp({
      cwd: base,
      targetDir: "dry-app",
      yes: true,
      dryRun: true,
      install: false,
      log: () => {},
    });
    expect(dry.files.length).toBeGreaterThan(5);
    expect(existsSync(join(base, "dry-app"))).toBe(false);
  });

  test("built dist/index.js executes end-to-end under plain Node", () => {
    const binPath = resolve(import.meta.dir, "../dist/index.js");
    if (!existsSync(binPath)) return;
    const base = makeTempDir();
    const res = spawnSync("node", [
      binPath, "demo-site", "--template", "next", "--db", "pglite", "--pm", "bun", "--yes", "--no-install",
    ], { cwd: base, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: undefined } });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Created demo-site");
    expect(res.stdout).not.toContain("\u001B[");
    expect(existsSync(join(base, "demo-site/src/xenon.config.ts"))).toBe(true);
    expect(existsSync(join(base, "demo-site/package.json"))).toBe(true);
  });
});
