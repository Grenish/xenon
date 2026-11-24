import { expect, spyOn, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { pgliteAdapter } from "../../src/adapters/postgres/pglite";
import { defineCollection, defineConfig, text } from "../../src/index";
import { dispatchAdminAction } from "../../src/next/admin/action";
import { unpublishedChangesOnPage } from "../../src/next/admin/page";
import { toClientCollection } from "../../src/ui/shared/client-config";
import { documentSummaryTitle, type SearchInput, type SearchResult } from "../../src/ui/shared/services";

const media = defineCollection({
  slug: "media", upload: true, fields: { alt: text(), caption: text() }, admin: { useAsTitle: "caption" },
});

for (const makeDatabase of [memoryAdapter, pgliteAdapter]) {
  test(`image searches paginate and count matching uploads on ${makeDatabase.name}`, async () => {
    const db = makeDatabase();
    const cfg = defineConfig({ collections: [media], db, auth: { baseURL: "http://localhost:3000", apiKeys: [{ key: "picker-key", role: "editor" }] } });
    async function search(input: Omit<SearchInput, "collection">) {
      const response = await dispatchAdminAction(cfg, { type: "doc.search", collection: "media", ...input }, new Headers({ authorization: "Bearer picker-key" }));
      if (!response.ok) throw new Error(response.error.message);
      return response.data as SearchResult;
    }
    await db.init();
    try {
      const ids: string[] = [];
      for (const [mimeType, caption, filename] of [
        ["image/png", "Flower bed", "one.png"], ["image/jpeg", "Trees", "flowers.jpg"],
        ["image/webp", "Flowers", "three.webp"], ["image/bmp", "Beach", "four.bmp"],
        ["application/pdf", "Flowers", "notes.pdf"], ["application/x-image/archive", "Flowers", "old.bin"],
      ] as const) {
        const row = await db.create({ collection: "media", slug: null, status: "published", draftData: null, data: { caption, filename, mimeType, alt: "Alternate text" } });
        ids.push(row.id);
      }
      const input = { query: "flower", imagesOnly: true, limit: 2 };
      const first = await search(input);
      const second = await search({ ...input, page: 2 });
      expect(first).toMatchObject({ totalDocs: 3, page: 1, hasNextPage: true });
      expect(first.docs).toHaveLength(2);
      expect(second).toMatchObject({ totalDocs: 3, page: 2, hasNextPage: false });
      expect([...first.docs, ...second.docs].map(doc => doc.title).sort()).toEqual(["Flower bed", "Flowers", "Trees"]);
      expect((await search({ imagesOnly: true })).totalDocs).toBe(4);
      expect((await search({ query: "flower" })).totalDocs).toBe(5);
      expect((await search({ ids: [...ids].reverse(), imagesOnly: true })).docs.map(doc => doc.id)).toEqual(ids.slice(0, 4).reverse());
    } finally {
      await db.close?.();
    }
  }, 30_000);
}

test("new upload summaries prefer the collection title, then the stored and original filenames", () => {
  const titleKey = toClientCollection(media).admin.useAsTitle;
  const data = { alt: "Alt text", caption: "Front cover", filename: "cover.jpg" };
  expect(documentSummaryTitle(data, titleKey, "original.jpg")).toBe("Front cover");
  expect(documentSummaryTitle({ ...data, caption: " " }, titleKey, "original.jpg")).toBe("cover.jpg");
  expect(documentSummaryTitle({ alt: data.alt }, titleKey, "original.jpg")).toBe("original.jpg");
});

test("collection lists look up draft changes once and only for visible published rows", async () => {
  const db = memoryAdapter();
  const record = { collection: "posts", slug: null, data: {}, status: "published" as const, draftData: null };
  const live = await db.create(record);
  const changed = await db.create({ ...record, draftData: {} });
  const draft = await db.create({ ...record, status: "draft", draftData: { title: "Draft" } });
  await db.create({ ...record, draftData: { title: "Off page" } });
  const find = spyOn(db, "find");
  expect(await unpublishedChangesOnPage(db, "posts", [live, changed, draft])).toEqual(new Set([changed.id]));
  expect(find).toHaveBeenCalledTimes(1);
  expect(find.mock.calls[0]?.[0]).toEqual({ collection: "posts", source: "draft", where: { id: { in: [live.id, changed.id] } }, limit: 2 });
  expect(await unpublishedChangesOnPage(db, "posts", [draft])).toEqual(new Set<string>());
  expect(await unpublishedChangesOnPage(db, "posts", [])).toEqual(new Set<string>());
  expect(find).toHaveBeenCalledTimes(1);
});
