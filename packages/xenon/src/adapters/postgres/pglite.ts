import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as fs from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { cached, createDatabaseAdapter } from "./database";

export function pgliteAdapter({ dataDir }: { dataDir?: string } = {}) {
  // PGlite strips file:// before opening the native path. Other storage schemes
  // (memory://, idb://, etc.) must be passed to the driver verbatim.
  const path = dataDir?.startsWith("file://") ? dataDir.slice(7) : dataDir;
  const fileBacked = !!path && !/^[a-z][a-z0-9+.-]*:\/\//i.test(path);
  return createDatabaseAdapter(async () => {
    let directory = dataDir;
    if (fileBacked) {
      const absolute = resolve(/*turbopackIgnore: true*/ path);
      await mkdir(/*turbopackIgnore: true*/ absolute, { recursive: true });
      directory = await realpath(/*turbopackIgnore: true*/ absolute);
    }
    return cached(directory ? `pglite:${directory}` : null, async () => {
      const release = fileBacked ? lockDataDir(directory!) : () => {};
      try {
        const client = directory ? new PGlite(directory) : new PGlite();
        await client.waitReady;
        return { db: drizzle(client), close: async () => { try { await client.close(); } finally { release(); } } };
      } catch (err) {
        release();
        throw err;
      }
    });
  });
}

function ownerIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function readOwner(lockPath: string): number | undefined {
  try {
    return Number(fs.readFileSync(lockPath, "utf8").trim());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// Only one contender may remove the dead owner's lock. Otherwise a delayed
// second unlink can remove a replacement lock already held by a live process.
function removeStaleLock(lockPath: string, owner: number) {
  const prefix = basename(lockPath) + ".reclaim-";
  const claim = fs.mkdtempSync(`${lockPath}.reclaim-${process.pid}-`);
  try {
    for (const entry of fs.readdirSync(dirname(lockPath))) {
      if (!entry.startsWith(prefix) || entry === basename(claim)) continue;
      const pid = Number(entry.slice(prefix.length).split("-")[0]);
      if (Number.isSafeInteger(pid) && pid > 0 && ownerIsAlive(pid)) return;
    }
    if (readOwner(lockPath) === owner) fs.unlinkSync(lockPath);
  } finally {
    fs.rmdirSync(claim);
  }
}

/** PGlite has no cross-process data directory lock of its own. */
function lockDataDir(dataDir: string): () => void {
  const lockPath = `${dataDir}.lock`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readOwner(lockPath);
      // Another process may be publishing its PID or removing a stale lock.
      if (!owner || !Number.isSafeInteger(owner) || owner < 0) continue;
      if (ownerIsAlive(owner)) {
        throw new Error(
          `[xenon] The PGlite database in "${dataDir}" is already open in another process (pid ${owner}). ` +
            "PGlite allows one process at a time; two processes on one folder corrupt it. Stop the other process " +
            "(another dev server, `next build`, a script) or use DATABASE_URL with a Postgres server for multi-process setups.",
        );
      }
      removeStaleLock(lockPath, owner);
      continue;
    }
    const release = () => {
      process.removeListener("exit", release);
      if (readOwner(lockPath) === process.pid) fs.unlinkSync(lockPath);
    };
    process.once("exit", release);
    return release;
  }
  throw new Error(`[xenon] Could not acquire the PGlite lock for "${dataDir}".`);
}
