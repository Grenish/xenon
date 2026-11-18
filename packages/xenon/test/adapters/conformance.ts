import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SlugConflictError, UpdateConflictError } from "../../src/adapters/types";
import type { CreateRecordInput, DatabaseAdapter, DocumentRecord, Where } from "../../src/adapters/types";

/** Every database implementation runs these tests through the public adapter interface. */
export function runDatabaseAdapterConformance(name: string, factory: () => Promise<DatabaseAdapter>) {
  describe(`${name} DatabaseAdapter conformance`, () => {
    let db: DatabaseAdapter;
    beforeEach(async () => { db = await factory(); await db.init(); });
    afterEach(async () => { await db?.close?.(); });

    function create(data: Record<string, unknown>, extra: Partial<CreateRecordInput> = {}) {
      return db.create({ collection: "posts", slug: null, status: "published", data, draftData: null, ...extra });
    }
    async function find(where: Where = {}, source: "published" | "draft" = "published") {
      return db.find({ collection: "posts", source, where, limit: 0 });
    }
    async function seed() {
      await create({ label: "a", title: "Alpha NEWS", count: 2, flag: true, nullable: null, tags: ["red", "blue"], obj: { a: 1, b: 2 } });
      await create({ label: "b", title: "Beta", count: 10, flag: false, tags: ["blue"], obj: { b: 2, a: 1 } });
      await create({ label: "c", title: "gamma", count: "2", nullable: "set", tags: [{ x: 1 }], obj: { a: 2 } });
      await create({ label: "d" });
    }

    test("init is idempotent; creates UUIDs and adapter-owned Date timestamps", async () => {
      await db.init();
      const before = Date.now();
      const row = await create({ title: "Hello" });
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
      expect(await db.findById("posts", row.id)).toEqual(row);
      await db.init();
      expect(await db.findById("posts", row.id)).toEqual(row);
    });

    test("collections isolate reads, updates, deletes, and lists", async () => {
      const row = await create({ title: "Hello" });
      expect(await db.findById("other", row.id)).toBeNull();
      expect(await db.update("other", row.id, { data: { changed: true } })).toBeNull();
      expect(await db.delete("other", row.id)).toBe(false);
      expect((await db.find({ collection: "other", source: "draft" })).docs).toEqual([]);
      expect((await db.findById("posts", row.id))?.data).toEqual({ title: "Hello" });
    });

    test("updates patch row columns, replace data, preserve identity/createdAt, and bump updatedAt", async () => {
      const original = await create({ title: "Hello", old: true }, { slug: "hello" });
      const updated = await db.update("posts", original.id, { data: { title: "Changed" }, draftData: { title: "Draft" }, status: "draft" });
      expect(updated).not.toBeNull();
      expect(updated?.id).toBe(original.id);
      expect(updated?.slug).toBe("hello");
      expect(updated?.createdAt).toEqual(original.createdAt);
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(original.updatedAt.getTime());
      expect(updated?.data).toEqual({ title: "Changed" });
      expect(updated?.draftData).toEqual({ title: "Draft" });
      expect(updated?.status).toBe("draft");
      expect((await db.update("posts", original.id, { draftData: null, slug: null }))?.draftData).toBeNull();
      expect((await db.findById("posts", original.id))?.slug).toBeNull();
      expect(await db.update("posts", crypto.randomUUID(), {})).toBeNull();
    });

    test("updatedAt is strictly increasing, even for back-to-back updates", async () => {
      const row = await create({ title: "Hello" });
      let previous = row.updatedAt.getTime();
      for (let i = 0; i < 5; i++) {
        const next = await db.update("posts", row.id, { data: { title: `v${i}` } });
        expect(next!.updatedAt.getTime()).toBeGreaterThan(previous);
        previous = next!.updatedAt.getTime();
      }
    });

    test("ifUpdatedAt updates only the version it names (optimistic concurrency)", async () => {
      const row = await create({ title: "Hello" });
      const first = await db.update("posts", row.id, { data: { title: "First" } }, { ifUpdatedAt: row.updatedAt });
      expect(first?.data).toEqual({ title: "First" });
      // The original version is now stale.
      await expect(db.update("posts", row.id, { data: { title: "Stale" } }, { ifUpdatedAt: row.updatedAt })).rejects.toBeInstanceOf(UpdateConflictError);
      expect((await db.findById("posts", row.id))?.data).toEqual({ title: "First" });
      // The current version works; a missing row is still "not found", not a conflict.
      expect((await db.update("posts", row.id, { data: { title: "Second" } }, { ifUpdatedAt: first!.updatedAt }))?.data).toEqual({ title: "Second" });
      expect(await db.update("posts", crypto.randomUUID(), { data: {} }, { ifUpdatedAt: row.updatedAt })).toBeNull();
    });

    test("delete returns true once, then false", async () => {
      const row = await create({});
      expect(await db.delete("posts", row.id)).toBe(true);
      expect(await db.delete("posts", row.id)).toBe(false);
      expect(await db.findById("posts", row.id)).toBeNull();
    });

    test("non-null slugs are unique across statuses, but scoped to their collection", async () => {
      await create({}, { slug: "hello", status: "draft" });
      await expect(create({}, { slug: "hello" })).rejects.toBeInstanceOf(SlugConflictError);
      const other = await create({}, { slug: "hello", collection: "other" });
      expect(other.slug).toBe("hello");
      await create({}, { slug: null });
      await create({}, { slug: null });
      const row = await create({}, { slug: "another" });
      await expect(db.update("posts", row.id, { slug: "hello", data: { changed: true } })).rejects.toBeInstanceOf(SlugConflictError);
      expect((await db.findById("posts", row.id))?.slug).toBe("another");
      expect((await db.findById("posts", row.id))?.data).toEqual({});
      expect((await db.update("posts", row.id, { slug: "another" }))?.slug).toBe("another");
    });

    test("concurrent duplicate creates admit only one slug", async () => {
      const results = await Promise.allSettled([create({}, { slug: "unique" }), create({}, { slug: "unique" })]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((result) => result.status === "rejected");
      expect(failure?.status === "rejected" && failure.reason).toBeInstanceOf(SlugConflictError);
    });

    test("inputs and returned records are deep copies, including nested data, drafts and dates", async () => {
      const input = { nested: { value: 1 }, array: [1] };
      const draft = { nested: { value: 2 } };
      const row = await create(input, { draftData: draft });
      input.nested.value = 9; input.array.push(2); draft.nested.value = 9;
      (row.data.nested as { value: number }).value = 9;
      (row.draftData!.nested as { value: number }).value = 9;
      row.createdAt.setFullYear(2000); row.updatedAt.setFullYear(2000);
      const fetched = (await db.findById("posts", row.id))!;
      expect(fetched.data).toEqual({ nested: { value: 1 }, array: [1] });
      expect(fetched.draftData).toEqual({ nested: { value: 2 } });
      expect(fetched.createdAt.getFullYear()).not.toBe(2000);
      expect(fetched.updatedAt.getFullYear()).not.toBe(2000);
      const updatedInput = { nested: { value: 3 } };
      const updated = (await db.update("posts", row.id, { data: updatedInput }))!;
      updatedInput.nested.value = 8; (updated.data.nested as { value: number }).value = 8;
      const list = await find();
      (list.docs[0]!.data.nested as { value: number }).value = 8;
      (fetched.data.nested as { value: number }).value = 8;
      expect((await db.findById("posts", row.id))?.data).toEqual({ nested: { value: 3 } });
    });

    test("published source selects live rows; draft source uses draftData with live fallback", async () => {
      const live = await create({ title: "live", rank: 1 }, { draftData: { title: "working", rank: 3 } });
      const draft = await create({}, { status: "draft", draftData: { title: "new", rank: 2 } });
      const fallback = await create({ title: "fallback", rank: 4 });
      expect((await find()).docs.map((row) => row.id).sort()).toEqual([live.id, fallback.id].sort());
      expect((await find({}, "draft")).totalDocs).toBe(3);
      expect((await find({ title: { equals: "working" } })).totalDocs).toBe(0);
      expect((await find({ title: { equals: "working" } }, "draft")).docs[0]?.id).toBe(live.id);
      expect((await find({ title: { equals: "fallback" } }, "draft")).docs[0]?.id).toBe(fallback.id);
      const sorted = await db.find({ collection: "posts", source: "draft", sort: "rank" });
      expect(sorted.docs.map((row) => row.id)).toEqual([draft.id, live.id, fallback.id]);
      // Adapters return raw records, keeping both source copies intact.
      expect(sorted.docs[1]?.data).toEqual({ title: "live", rank: 1 });
      expect(sorted.docs[1]?.draftData).toEqual({ title: "working", rank: 3 });
    });

    const cases: { name: string; where: Where; labels: string[] }[] = [
      { name: "empty", where: {}, labels: ["a", "b", "c", "d"] },
      { name: "strict numeric equals", where: { count: { equals: 2 } }, labels: ["a"] },
      { name: "strict string equals", where: { count: { equals: "2" } }, labels: ["c"] },
      { name: "boolean equals", where: { flag: { equals: false } }, labels: ["b"] },
      { name: "deep object equals ignores key order", where: { obj: { equals: { a: 1, b: 2 } } }, labels: ["a", "b"] },
      { name: "deep array equals respects order", where: { tags: { equals: ["red", "blue"] } }, labels: ["a"] },
      { name: "null equals absent or null", where: { nullable: { equals: null } }, labels: ["a", "b", "d"] },
      { name: "not equals includes missing", where: { nullable: { not_equals: "set" } }, labels: ["a", "b", "d"] },
      { name: "not null", where: { nullable: { not_equals: null } }, labels: ["c"] },
      { name: "in", where: { count: { in: [2, 10] } }, labels: ["a", "b"] },
      { name: "not in includes missing", where: { count: { not_in: [2, 10] } }, labels: ["c", "d"] },
      { name: "in null includes missing", where: { nullable: { in: [null] } }, labels: ["a", "b", "d"] },
      { name: "empty in", where: { count: { in: [] } }, labels: [] },
      { name: "empty not in", where: { count: { not_in: [] } }, labels: ["a", "b", "c", "d"] },
      { name: "case insensitive substring", where: { title: { contains: "NEWS" } }, labels: ["a"] },
      { name: "array membership", where: { tags: { contains: "blue" } }, labels: ["a", "b"] },
      { name: "array membership is case sensitive", where: { tags: { contains: "BLUE" } }, labels: [] },
      { name: "deep array membership", where: { tags: { contains: { x: 1 } } }, labels: ["c"] },
      { name: "contains incompatible scalar", where: { count: { contains: 2 } }, labels: [] },
      { name: "gt", where: { count: { gt: 2 } }, labels: ["b"] },
      { name: "gte", where: { count: { gte: 2 } }, labels: ["a", "b"] },
      { name: "lt", where: { count: { lt: 10 } }, labels: ["a"] },
      { name: "lte", where: { count: { lte: 2 } }, labels: ["a"] },
      { name: "binary string gt", where: { title: { gt: "Beta" } }, labels: ["c"] },
      { name: "exists true", where: { nullable: { exists: true } }, labels: ["c"] },
      { name: "exists false", where: { nullable: { exists: false } }, labels: ["a", "b", "d"] },
      { name: "sibling operators AND", where: { count: { gte: 2, lt: 10 } }, labels: ["a"] },
      { name: "sibling fields AND", where: { flag: { equals: true }, count: { equals: 10 } }, labels: [] },
      { name: "nested and/or", where: { and: [{ or: [{ count: { equals: 2 } }, { count: { equals: 10 } }] }, { flag: { equals: true } }] }, labels: ["a"] },
      { name: "or with sibling AND", where: { or: [{ count: { equals: 2 } }, { count: { equals: 10 } }], flag: { equals: false } }, labels: ["b"] },
      { name: "empty AND", where: { and: [] }, labels: ["a", "b", "c", "d"] },
      { name: "empty OR", where: { or: [] }, labels: [] },
      { name: "missing is not inherited property", where: { toString: { exists: false } }, labels: ["a", "b", "c", "d"] },
    ];
    test.each(cases)("where: $name", async ({ where, labels }) => {
      await seed();
      const result = await find(where);
      expect(result.docs.map((row) => row.data.label as string).sort()).toEqual(labels);
      expect(result.totalDocs).toBe(labels.length);
    });

    test("system filters use columns and accept Date or ISO timestamp operands", async () => {
      const row = await create({ id: "fake-id", status: "fake-status", slug: "fake-slug" }, { slug: "real-slug" });
      for (const where of [
        { id: { equals: row.id } }, { status: { equals: "published" } }, { slug: { equals: "real-slug" } },
        { createdAt: { equals: row.createdAt } }, { createdAt: { equals: row.createdAt.toISOString() } },
        { updatedAt: { gte: row.updatedAt.toISOString() } },
      ] as Where[]) expect((await find(where)).docs.map((doc) => doc.id)).toEqual([row.id]);
      expect((await find({ id: { equals: "fake-id" } })).totalDocs).toBe(0);
    });

    test("scalar numeric equality follows strict equality for negative zero", async () => {
      const row = await create({ value: -0 });
      expect((await find({ value: { equals: 0 } })).docs.map((doc) => doc.id)).toEqual([row.id]);
    });

    test("numbers sort numerically; missing values last in both directions; id ties ascending", async () => {
      const two = await create({ rank: 2 });
      const ten = await create({ rank: 10 });
      const anotherTwo = await create({ rank: 2 });
      const absent = await create({});
      const nullable = await create({ rank: null });
      const tied = [two.id, anotherTwo.id].sort();
      const missing = [absent.id, nullable.id].sort();
      for (const [sort, expected] of [["rank", [...tied, ten.id, ...missing]], ["-rank", [ten.id, ...tied, ...missing]]] as const) {
        expect((await db.find({ collection: "posts", source: "published", sort })).docs.map((row) => row.id)).toEqual([...expected]);
      }
    });

    test("sort and comparison use code points, including astral characters versus BMP", async () => {
      const inputs = ["😀", "\uE000", "é", "Z", "a"];
      for (const word of inputs) await create({ word });
      expect((await db.find({ collection: "posts", source: "published", sort: "word" })).docs.map((row) => row.data.word)).toEqual(["Z", "a", "é", "\uE000", "😀"]);
      expect((await db.find({ collection: "posts", source: "published", sort: "-word" })).docs.map((row) => row.data.word)).toEqual(["😀", "\uE000", "é", "a", "Z"]);
      expect((await find({ word: { gt: "\uE000" } })).docs.map((row) => row.data.word)).toEqual(["😀"]);
    });

    test("pagination defaults, no-limit, ties, and out-of-range totals", async () => {
      const rows: DocumentRecord[] = [];
      for (let index = 0; index < 12; index++) rows.push(await create({ rank: 1, index }));
      const defaultResult = await db.find({ collection: "posts", source: "published" });
      const expected = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      expect(defaultResult.docs.map((row) => row.id)).toEqual(expected.slice(0, 10).map((row) => row.id));
      expect(defaultResult).toMatchObject({ totalDocs: 12, limit: 10, page: 1, totalPages: 2, hasNextPage: true, hasPrevPage: false });
      const first = await db.find({ collection: "posts", source: "published", sort: "-rank", limit: 5 });
      const second = await db.find({ collection: "posts", source: "published", sort: "-rank", limit: 5, page: 2 });
      const byId = rows.map((row) => row.id).sort();
      expect(first.docs.map((row) => row.id)).toEqual(byId.slice(0, 5));
      expect(second.docs.map((row) => row.id)).toEqual(byId.slice(5, 10));
      expect(second).toMatchObject({ totalDocs: 12, limit: 5, page: 2, totalPages: 3, hasNextPage: true, hasPrevPage: true });
      expect(await db.find({ collection: "posts", source: "published", limit: 5, page: 9 })).toEqual({ docs: [], totalDocs: 12, limit: 5, page: 9, totalPages: 3, hasNextPage: false, hasPrevPage: true });
      expect(await db.find({ collection: "posts", source: "published", limit: 0, page: 2 })).toEqual({ docs: [], totalDocs: 12, limit: 0, page: 2, totalPages: 1, hasNextPage: false, hasPrevPage: true });
      expect(await db.find({ collection: "posts", source: "published", limit: 0 })).toMatchObject({ totalDocs: 12, totalPages: 1, hasNextPage: false, hasPrevPage: false });
      expect((await db.find({ collection: "posts", source: "published", limit: 0 })).docs).toHaveLength(12);
    });

    test("empty results retain a single page", async () => {
      expect(await db.find({ collection: "posts", source: "published" })).toEqual({ docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false });
    });

    test("auth database is provided and can be requested idempotently", async () => {
      const options = { user: { modelName: "xenon_users" }, session: { modelName: "xenon_sessions" }, account: { modelName: "xenon_accounts" }, verification: { modelName: "xenon_verifications" } };
      expect(await db.getAuthDatabase(options)).toBeDefined();
      expect(await db.getAuthDatabase(options)).toBeDefined();
    });
  });
}
