import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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

  test("relative, dotted and file:// paths share a handle until the last adapter closes", () =>
    withDir(async (dir) => {
      const path = relative(process.cwd(), dir);
      const adapters = [path, "./" + path, "file://" + dir].map(dataDir => pgliteAdapter({ dataDir }));
      try {
        await Promise.all(adapters.map(a => a.init()));
        for (const a of adapters) expect(a.db).toBe(adapters[0]!.db);
        await adapters[0]!.close?.();
        expect(existsSync(`${dir}.lock`)).toBe(true);
        expect(await adapters[1]!.findById("posts", "missing")).toBeNull();
      } finally {
        for (const a of adapters) await a.close?.();
      }
      expect(existsSync(`${dir}.lock`)).toBe(false);
    }), 30_000);

  test("retries when the lock disappears between exclusive creation and reading its owner", () =>
    withDir(async (dir) => {
      const lock = `${dir}.lock`;
      writeFileSync(lock, "2147483646");
      const adapter = pgliteAdapter({ dataDir: dir });
      const read = spyOn(fs, "readFileSync").mockImplementationOnce(() => {
        fs.unlinkSync(lock);
        throw Object.assign(new Error("lock removed"), { code: "ENOENT" });
      });
      try {
        await adapter.init();
        expect(read).toHaveBeenCalledWith(lock, "utf8");
        expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
      } finally {
        read.mockRestore();
        await adapter.close?.();
      }
    }), 30_000);

  test("fails closed when no attempt acquires the lock", () =>
    withDir(async (dir) => {
      const lock = `${dir}.lock`;
      writeFileSync(lock, "2147483646");
      // A live contender is examining this stale owner.
      fs.mkdirSync(`${lock}.reclaim-${process.ppid}-test`);
      await expect(pgliteAdapter({ dataDir: dir }).init()).rejects.toThrow(/could not acquire/i);
      expect(readFileSync(lock, "utf8")).toBe("2147483646");
    }));
});
