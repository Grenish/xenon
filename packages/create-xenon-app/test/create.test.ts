import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  });

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
