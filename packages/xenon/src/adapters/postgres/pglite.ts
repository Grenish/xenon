import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { cached, createDatabaseAdapter } from "./database";

export function pgliteAdapter({ dataDir }: { dataDir?: string } = {}) {
  // In-memory PGlite instances are never shared.
  return createDatabaseAdapter(() => cached(dataDir ? `pglite:${dataDir}` : null, async () => {
    // PGlite only creates the last path segment; make sure parents exist (plain paths, not memory:// / idb://).
    if (dataDir && !/^[a-z]+:\/\//i.test(dataDir)) {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(/*turbopackIgnore: true*/ dataDir, { recursive: true });
    }
    const fileBacked = !!dataDir && !/^[a-z]+:\/\//i.test(dataDir);
    const release = fileBacked ? await lockDataDir(dataDir) : () => {};
    try {
      const client = dataDir ? new PGlite(dataDir) : new PGlite();
      await client.waitReady;
      return { db: drizzle(client), close: async () => { try { await client.close(); } finally { release(); } } };
    } catch (err) {
      release();
      throw err;
    }
  }));
}

/**
 * PGlite has no cross-process locking: two processes on one data directory (a dev server and
 * `next build`, two dev servers, a script) silently corrupt its write-ahead log. Guard the directory
 * with a sibling lock file holding the owner's pid; a stale lock (dead pid) is taken over.
 */
async function lockDataDir(dataDir: string): Promise<() => void> {
  const fs = await import("node:fs");
  const { resolve } = await import("node:path");
  const lockPath = `${resolve(/*turbopackIgnore: true*/ dataDir)}.lock`;
  const mine = String(process.pid);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(lockPath, mine, { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const owner = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
      if (owner === process.pid) break;
      let alive = false;
      if (Number.isInteger(owner) && owner > 0) {
        try { process.kill(owner, 0); alive = true; } catch (e) { alive = (e as NodeJS.ErrnoException).code === "EPERM"; }
      }
      if (alive) {
        throw new Error(
          `[xenon] The PGlite database in "${dataDir}" is already open in another process (pid ${owner}). ` +
            "PGlite allows one process at a time; two processes on one folder corrupt it. Stop the other process " +
            "(another dev server, `next build`, a script) or use DATABASE_URL with a Postgres server for multi-process setups.",
        );
      }
      try { fs.unlinkSync(lockPath); } catch { /* raced with another process; retry */ }
    }
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { if (fs.readFileSync(lockPath, "utf8").trim() === mine) fs.unlinkSync(lockPath); } catch { /* already gone */ }
  };
  process.once("exit", release);
  return release;
}
