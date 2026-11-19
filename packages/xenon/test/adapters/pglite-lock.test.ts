import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pgliteAdapter } from "../../src/adapters/postgres/pglite";

/** PGlite has no cross-process locking; the adapter guards a file-backed data directory itself. */
describe("PGlite data directory lock", () => {
  async function withDir(run: (dir: string) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), "xenon-lock-"));
    try { await run(join(root, "pgdata")); } finally { await rm(root, { recursive: true, force: true }); }
  }

  test("refuses a directory another live process holds, with an actionable error", () =>
    withDir(async (dir) => {
      writeFileSync(`${dir}.lock`, String(process.ppid)); // a live process that isn't us
      await expect(pgliteAdapter({ dataDir: dir }).init()).rejects.toThrow(/already open in another process/);
      expect(readFileSync(`${dir}.lock`, "utf8")).toBe(String(process.ppid));
    }));

  test("takes over a stale lock, holds it while open and releases it on close", () =>
    withDir(async (dir) => {
      writeFileSync(`${dir}.lock`, "2147483646"); // no such process
      const adapter = pgliteAdapter({ dataDir: dir });
      await adapter.init();
      expect(readFileSync(`${dir}.lock`, "utf8")).toBe(String(process.pid));
      await adapter.close?.();
      expect(existsSync(`${dir}.lock`)).toBe(false);
    }), 30_000);
});
