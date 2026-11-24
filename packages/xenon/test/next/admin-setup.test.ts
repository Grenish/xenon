import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { XenonError } from "../../src/core/errors";
import type { XenonConfig } from "../../src/core/types";
import { claimSetup } from "../../src/next/admin/action";

function config(): XenonConfig {
  return { db: memoryAdapter() } as unknown as XenonConfig;
}

describe("first-run setup lock", () => {
  test("concurrent setups: exactly one claims the lock", async () => {
    const cfg = config();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => claimSetup(cfg)));
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won.length).toBe(1);
    expect(lost.length).toBe(7);
    for (const r of lost) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(XenonError);
      expect(((r as PromiseRejectedResult).reason as XenonError).code).toBe("FORBIDDEN");
    }
  });

  test("releasing the lock lets a retry claim it again", async () => {
    const cfg = config();
    const release = await claimSetup(cfg);
    await expect(claimSetup(cfg)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await release();
    const second = await claimSetup(cfg);
    expect(typeof second).toBe("function");
  });

  test("the lock row is hidden from user collections", async () => {
    const cfg = config();
    await claimSetup(cfg);
    const { docs } = await cfg.db!.find({ collection: "posts", source: "published", limit: 0 });
    expect(docs.length).toBe(0);
  });
});
