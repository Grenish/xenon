import { afterAll, describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { pgliteAdapter } from "../../src/adapters/postgres/pglite";
import { summarizeRecords } from "../../src/adapters/summary";
import type { DatabaseAdapter, FindArgs, StorageAdapter } from "../../src/adapters/types";
import type { XenonUser } from "../../src/core/types";
import { defineCollection, defineConfig, text } from "../../src/index";
import { loadDashboard } from "../../src/next/admin/dashboard-data";
import { createXenon } from "../../src/server/xenon";

/* Regression tests for audit Medium #16 (loadDashboard). */

const admin: XenonUser = { id: "u1", email: "admin@example.com", name: "Admin", role: "admin" };
const posts = defineCollection({
  slug: "posts",
  admin: { useAsTitle: "headline" },
  fields: { title: text({ required: true }), headline: text() },
});
const media = defineCollection({ slug: "media", upload: true, fields: { alt: text() } });

const storage: StorageAdapter = {
  name: "test",
  upload: async ({ key }) => ({ key, url: `https://old.example/${key}` }),
  delete: async () => {},
  getUrl: (key) => `https://cdn.example/${key}`,
};

const pglite = pgliteAdapter();
afterAll(async () => { await pglite.close?.(); });

async function reset(db: DatabaseAdapter) {
  await db.init();
  for (const collection of ["posts", "media"]) {
    const { docs } = await db.find({ collection, source: "draft", limit: 0 });
    for (const doc of docs) await db.delete(collection, doc.id);
  }
}

/** Seeds a mixed set of records directly through the adapter. */
async function seed(db: DatabaseAdapter) {
  await reset(db);
  await db.create({ collection: "posts", slug: null, status: "published", data: { title: "Live", headline: "Live headline" }, draftData: null });
  const changed = await db.create({ collection: "posts", slug: null, status: "published", data: { title: "Changed", headline: "Old headline" }, draftData: null });
  // Pending draft that cleared the headline.
  await db.update("posts", changed.id, { draftData: { title: "Changed" } });
  await db.create({ collection: "posts", slug: null, status: "draft", data: {}, draftData: { title: "Draft", headline: "Draft headline" } });
  for (const [name, mimeType, filesize] of [["a.png", "image/png", 100], ["b.pdf", "application/pdf", 50], ["c.jpg", "image/jpeg", 25]] as const) {
    const key = `media/2026/11/${name}`;
    await db.create({
      collection: "media", slug: null, status: "published", draftData: null,
      data: { filename: name, mimeType, filesize, alt: `alt ${name}`, url: `https://old.example/${key}`, _file: { key } },
    });
  }
  return { changedId: changed.id };
}

/** Wraps an adapter, recording every `find` call. */
function spy(db: DatabaseAdapter) {
  const finds: FindArgs[] = [];
  const wrapped: DatabaseAdapter = Object.create(db);
  wrapped.find = (args) => { finds.push(args); return db.find(args); };
  return { db: wrapped, finds };
}

describe("#16 loadDashboard", () => {
  test("PostgreSQL summarize() agrees with the portable summarizeRecords()", async () => {
    await seed(pglite);
    const args = { since: new Date(Date.now() - 86_400_000), recent: 2, attention: 1, images: 5 };
    for (const collection of ["posts", "media"]) {
      const fast = await pglite.summarize!({ collection, ...args });
      const all = (await pglite.find({ collection, source: "draft", limit: 0 })).docs;
      const slow = summarizeRecords(all, { collection, ...args });
      const ids = (s: typeof fast) => ({ ...s, recent: s.recent.map((r) => r.id), attention: s.attention.map((r) => r.id), images: s.images.map((r) => r.id),
        edited: s.edited.map(Number).sort(), created: s.created.map(Number).sort() });
      expect(ids(fast)).toEqual(ids(slow));
    }
    const postsSummary = await pglite.summarize!({ collection: "posts", ...args });
    expect([postsSummary.total, postsSummary.published, postsSummary.drafts, postsSummary.changed, postsSummary.attentionTotal]).toEqual([3, 2, 1, 1, 2]);
    const mediaSummary = await pglite.summarize!({ collection: "media", ...args });
    expect(mediaSummary.bytes).toBe(175);
    expect(mediaSummary.images.map((r) => r.data.filename).sort()).toEqual(["a.png", "c.jpg"]);
  });

  for (const [name, base] of [["pglite", pglite], ["memory", memoryAdapter()]] as const) {
    test(`${name}: figures, no resurrected draft fields, current storage URLs`, async () => {
      await seed(base);
      const { db, finds } = spy(base);
      const config = defineConfig({ collections: [posts, media], db, storage });
      const data = await loadDashboard(createXenon(config), config, admin);

      expect(data.collections).toEqual([
        { slug: "posts", total: 3, published: 2, drafts: 1, changed: 1, bytes: null },
        { slug: "media", total: 3, published: 3, drafts: 0, changed: 0, bytes: 175 },
      ]);
      expect(data.attentionTotal).toBe(2);
      expect(data.activity.edited).toHaveLength(6);
      expect(data.activity.created).toHaveLength(6);

      // The pending draft cleared `headline`: the live "Old headline" must not come back.
      const titles = data.recent.filter((d) => d.collection === "posts").map((d) => d.title);
      expect(titles).not.toContain("Old headline");
      expect(titles).toContain("Draft headline");
      expect(data.recent.find((d) => d.status === "published" && d.changed)?.title).not.toBe("Old headline");

      // Thumbnails come from storage.getUrl, not the URL stored at upload time; non-images are skipped.
      // (Order is by updatedAt; seeded rows can share a millisecond, so compare as sets.)
      expect(data.media.map((m) => m.url).sort()).toEqual(["https://cdn.example/media/2026/11/a.png", "https://cdn.example/media/2026/11/c.jpg"]);
      expect(data.media.map((m) => m.alt).sort()).toEqual(["alt a.png", "alt c.jpg"]);

      // PostgreSQL never loads whole collections (limit 0); the memory adapter falls back to it.
      const fullLoads = finds.filter((f) => f.limit === 0);
      expect(fullLoads.length).toBe(name === "pglite" ? 0 : 2);
    });
  }

  test("collections the user may not read are skipped", async () => {
    const hidden = defineCollection({ slug: "posts", access: { read: () => false }, fields: { title: text({ required: true }) } });
    const db = memoryAdapter();
    const config = defineConfig({ collections: [hidden], db });
    await db.create({ collection: "posts", slug: null, status: "published", data: { title: "x" }, draftData: null });
    const data = await loadDashboard(createXenon(config), config, admin);
    expect(data.collections).toEqual([]);
    expect(data.recent).toEqual([]);
  });
});
