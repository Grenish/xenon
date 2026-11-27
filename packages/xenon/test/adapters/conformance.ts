import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SlugConflictError, UniqueConflictError, UpdateConflictError } from "../../src/adapters/types";
import type { CreateRecordInput, DatabaseAdapter, DocumentRecord, VersionRecord, Where } from "../../src/adapters/types";

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

    test("nested dot-path where and sort traverse JSON objects consistently", async () => {
      await create({ label: "a", seo: { noIndex: true, score: 10, title: "Alpha", nested: { code: "X1" } } });
      await create({ label: "b", seo: { noIndex: false, score: 2, title: "Beta", tags: ["news", "hot"] } });
      await create({ label: "c", seo: { noIndex: null, title: "gamma" } });
      await create({ label: "d", seo: [{ noIndex: true }] });
      await create({ label: "e" });

      expect((await find({ "seo.noIndex": { equals: true } })).docs.map((r) => r.data.label)).toEqual(["a"]);
      expect((await find({ "seo.noIndex": { equals: false } })).docs.map((r) => r.data.label)).toEqual(["b"]);
      expect((await find({ "seo.noIndex": { equals: null } })).docs.map((r) => r.data.label).sort()).toEqual(["c", "d", "e"]);
      expect((await find({ "seo.noIndex": { exists: true } })).docs.map((r) => r.data.label).sort()).toEqual(["a", "b"]);
      expect((await find({ "seo.noIndex": { exists: false } })).docs.map((r) => r.data.label).sort()).toEqual(["c", "d", "e"]);
      expect((await find({ "seo.score": { gt: 2 } })).docs.map((r) => r.data.label)).toEqual(["a"]);
      expect((await find({ "seo.score": { gte: 2, lte: 10 } })).docs.map((r) => r.data.label).sort()).toEqual(["a", "b"]);
      expect((await find({ "seo.title": { contains: "ALP" } })).docs.map((r) => r.data.label)).toEqual(["a"]);
      expect((await find({ "seo.tags": { contains: "hot" } })).docs.map((r) => r.data.label)).toEqual(["b"]);
      expect((await find({ "seo.nested.code": { equals: "X1" } })).docs.map((r) => r.data.label)).toEqual(["a"]);
      expect((await find({ "seo.noIndex": { not_equals: true } })).docs.map((r) => r.data.label).sort()).toEqual(["b", "c", "d", "e"]);
      expect((await find({ "seo..noIndex": { exists: false } })).totalDocs).toBe(5);

      // Nested sort: numeric ascending/descending, missing last
      const asc = await db.find({ collection: "posts", source: "published", sort: "seo.score" });
      expect(asc.docs.slice(0, 2).map((r) => r.data.label)).toEqual(["b", "a"]);
      const desc = await db.find({ collection: "posts", source: "published", sort: "-seo.score" });
      expect(desc.docs.slice(0, 2).map((r) => r.data.label)).toEqual(["a", "b"]);

      // Nested draft fallback
      const liveWithDraft = await create(
        { label: "f", seo: { noIndex: false } },
        { draftData: { label: "f", seo: { noIndex: true } } },
      );
      expect((await find({ "seo.noIndex": { equals: true } }, "published")).docs.map((r) => r.id)).not.toContain(liveWithDraft.id);
      expect((await find({ "seo.noIndex": { equals: true } }, "draft")).docs.map((r) => r.id)).toContain(liveWithDraft.id);
    });

    test("opt-in expression indexes and unique constraints enforce uniqueness across working and live data", async () => {
      await db.init({
        indexes: [
          { collection: "posts", path: ["sku"], type: "text", unique: true },
          { collection: "posts", path: ["code"], type: "number", unique: true },
          { collection: "posts", path: ["seo", "canonicalId"], type: "text", unique: true },
          { collection: "posts", path: ["priority"], type: "number", unique: false },
        ],
      });
      // Re-init with the same indexes is idempotent.
      await db.init({
        indexes: [
          { collection: "posts", path: ["sku"], type: "text", unique: true },
          { collection: "posts", path: ["priority"], type: "number", unique: false },
        ],
      });

      const a = await create({ sku: "SKU-1", code: 100, priority: 5, seo: { canonicalId: "canon-1" } }, { slug: "post-a" });
      // Null / missing values do not collide.
      await create({ sku: null, priority: 5 });
      await create({ priority: 10 });

      // Duplicate top-level text unique throws UniqueConflictError with exact path (even when slug is set!).
      try {
        await create({ sku: "SKU-1" }, { slug: "post-b" });
        expect.unreachable("expected UniqueConflictError");
      } catch (err) {
        expect(err).toBeInstanceOf(UniqueConflictError);
        expect((err as UniqueConflictError).path).toEqual(["sku"]);
      }

      // Duplicate top-level numeric unique (including -0 vs 0).
      await create({ code: -0 });
      await expect(create({ code: 0 })).rejects.toBeInstanceOf(UniqueConflictError);

      // Duplicate nested group unique throws UniqueConflictError with nested path.
      try {
        await create({ seo: { canonicalId: "canon-1" } });
        expect.unreachable("expected UniqueConflictError");
      } catch (err) {
        expect(err).toBeInstanceOf(UniqueConflictError);
        expect((err as UniqueConflictError).path).toEqual(["seo", "canonicalId"]);
      }

      // Slug collision still throws SlugConflictError when unique field is distinct.
      await expect(create({ sku: "SKU-DISTINCT" }, { slug: "post-a" })).rejects.toBeInstanceOf(SlugConflictError);

      // Collection isolation: same unique value in another collection succeeds.
      const other = await create({ sku: "SKU-1" }, { collection: "other" });
      expect(other.data.sku).toBe("SKU-1");

      // Self-update keeping same unique value succeeds; colliding update fails atomically.
      expect((await db.update("posts", a.id, { data: { sku: "SKU-1", code: 100, priority: 9, seo: { canonicalId: "canon-1" } } }))?.data.priority).toBe(9);
      const b = await create({ sku: "SKU-2", code: 200 });
      await expect(db.update("posts", b.id, { data: { sku: "SKU-1", code: 200 } })).rejects.toBeInstanceOf(UniqueConflictError);
      expect((await db.findById("posts", b.id))?.data.sku).toBe("SKU-2");

      // Draft uniqueness: two drafts cannot claim the same value, and a draft cannot collide with a published doc.
      await create({}, { status: "draft", draftData: { sku: "DRAFT-1" } });
      await expect(create({}, { status: "draft", draftData: { sku: "DRAFT-1" } })).rejects.toBeInstanceOf(UniqueConflictError);
      await expect(create({}, { status: "draft", draftData: { sku: "SKU-1" } })).rejects.toBeInstanceOf(UniqueConflictError);

      // Published doc with a pending draft change protects BOTH its live value (against another publish)
      // and its working draft value (against another draft/publish), releasing the old live value once published.
      await db.update("posts", a.id, { draftData: { sku: "SKU-1-NEXT", code: 100, seo: { canonicalId: "canon-1" } } });
      await expect(create({ sku: "SKU-1" })).rejects.toBeInstanceOf(UniqueConflictError);
      await expect(create({}, { status: "draft", draftData: { sku: "SKU-1-NEXT" } })).rejects.toBeInstanceOf(UniqueConflictError);
      // Publishing releases live SKU-1.
      await db.update("posts", a.id, { data: { sku: "SKU-1-NEXT", code: 100, seo: { canonicalId: "canon-1" } }, draftData: null, status: "published" });
      const reclaimed = await create({ sku: "SKU-1" });
      expect(reclaimed.data.sku).toBe("SKU-1");

      // Queries on indexed fields return accurate results (equality, range, in, sort).
      expect((await find({ sku: { equals: "SKU-1" } })).docs.map((r) => r.id)).toEqual([reclaimed.id]);
      expect((await find({ code: { in: [100, 200] } })).docs.map((r) => r.data.code).sort()).toEqual([100, 200]);
      expect((await find({ priority: { gte: 5 } })).totalDocs).toBe(2);
      expect((await find({ sku: { equals: "SKU-1-NEXT" } }, "draft")).docs.map((r) => r.id)).toEqual([a.id]);

      // Concurrent duplicate creates admit only one winner.
      const race = await Promise.allSettled([create({ sku: "RACE-1" }), create({ sku: "RACE-1" })]);
      expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loser = race.find((r) => r.status === "rejected");
      expect(loser?.status === "rejected" && loser.reason).toBeInstanceOf(UniqueConflictError);
    });

    /* ------------------------------ schedules (#16) ------------------------------ */

    test("schedule columns round-trip, stay absent when unset, and clear with null", async () => {
      const plain = await create({ title: "Plain" });
      expect("publishAt" in plain).toBe(false);
      expect("unpublishAt" in plain).toBe(false);
      const at = new Date("2030-01-01T10:00:00.000Z");
      const off = new Date("2030-02-01T10:00:00.000Z");
      const row = await create({}, { status: "draft", draftData: { title: "Later" }, publishAt: at });
      expect(row.publishAt).toEqual(at);
      expect((await db.findById("posts", row.id))?.publishAt).toEqual(at);
      const both = await db.update("posts", row.id, { unpublishAt: off });
      expect(both?.publishAt).toEqual(at);
      expect(both?.unpublishAt).toEqual(off);
      const cleared = await db.update("posts", row.id, { publishAt: null });
      expect(cleared?.publishAt ?? null).toBeNull();
      expect(cleared?.unpublishAt).toEqual(off);
      expect((await db.findById("posts", row.id))?.publishAt ?? null).toBeNull();
    });

    test("published reads hide rows whose unpublishAt has passed; draft reads keep them", async () => {
      const now = new Date("2030-01-01T12:00:00.000Z");
      const live = await create({ title: "Live" });
      const expiring = await create({ title: "Expiring" }, { unpublishAt: new Date("2030-01-01T13:00:00.000Z") });
      const gone = await create({ title: "Gone" }, { unpublishAt: new Date("2030-01-01T12:00:00.000Z") });
      const published = await db.find({ collection: "posts", source: "published", now, limit: 0 });
      expect(published.docs.map((r) => r.id).sort()).toEqual([live.id, expiring.id].sort());
      expect(published.totalDocs).toBe(2);
      const later = await db.find({ collection: "posts", source: "published", now: new Date("2030-01-01T13:00:00.000Z"), limit: 0 });
      expect(later.docs.map((r) => r.id)).toEqual([live.id]);
      const drafts = await db.find({ collection: "posts", source: "draft", now, limit: 0 });
      expect(drafts.docs.map((r) => r.id).sort()).toEqual([live.id, expiring.id, gone.id].sort());
    });

    test("findDue returns due publishes and due unpublishes of live rows, oldest first, across collections", async () => {
      if (!db.findDue) throw new Error("adapter must implement findDue");
      const t = (iso: string) => new Date(`2030-01-01T${iso}:00.000Z`);
      const a = await create({}, { status: "draft", draftData: { n: "a" }, publishAt: t("10:00") });
      const b = await db.create({ collection: "pages", slug: null, status: "published", data: { n: "b" }, draftData: null, unpublishAt: t("09:00") });
      await create({ n: "future" }, { status: "draft", draftData: {}, publishAt: t("13:00") });
      // Unpublish due, but already a draft: nothing to do.
      await create({}, { status: "draft", draftData: { n: "idle" }, unpublishAt: t("08:00") });
      await create({ n: "plain" });
      const due = await db.findDue({ now: t("12:00"), limit: 10 });
      expect(due.map((r) => r.id)).toEqual([b.id, a.id]);
      expect((await db.findDue({ now: t("12:00"), limit: 1 })).map((r) => r.id)).toEqual([b.id]);
      expect(await db.findDue({ now: t("07:00"), limit: 10 })).toEqual([]);
    });

    /* -------------------------------- trash (#18) -------------------------------- */

    test("trash: excluded by default, `only` / `include` scopes, restore with null, and keeps unique slugs", async () => {
      const live = await create({ title: "Live" }, { slug: "live" });
      const binned = await create({ title: "Binned" }, { slug: "binned" });
      const at = new Date("2030-03-01T00:00:00.000Z");
      const trashed = await db.update("posts", binned.id, { deletedAt: at });
      expect(trashed?.deletedAt).toEqual(at);
      expect("deletedAt" in live).toBe(false);

      const ids = async (trash?: "exclude" | "include" | "only", source: "published" | "draft" = "draft") =>
        (await db.find({ collection: "posts", source, trash, limit: 0 })).docs.map((r) => r.id).sort();
      expect(await ids()).toEqual([live.id]);
      expect(await ids(undefined, "published")).toEqual([live.id]);
      expect(await ids("only")).toEqual([binned.id]);
      expect(await ids("include")).toEqual([live.id, binned.id].sort());
      expect((await db.find({ collection: "posts", source: "draft", trash: "only" })).totalDocs).toBe(1);
      // findById still returns trashed rows: the caller decides.
      expect((await db.findById("posts", binned.id))?.deletedAt).toEqual(at);
      // A trashed row keeps its slug.
      await expect(create({}, { slug: "binned" })).rejects.toBeInstanceOf(SlugConflictError);

      const restored = await db.update("posts", binned.id, { deletedAt: null });
      expect(restored?.deletedAt ?? null).toBeNull();
      expect(await ids()).toEqual([live.id, binned.id].sort());
    });

    test("trash: trashed rows are never due for scheduled work", async () => {
      const at = new Date("2030-01-01T10:00:00.000Z");
      const row = await create({}, { status: "draft", draftData: { n: 1 }, publishAt: at });
      await db.update("posts", row.id, { deletedAt: at });
      expect(await db.findDue!({ now: new Date("2030-01-02T00:00:00.000Z"), limit: 10 })).toEqual([]);
    });

    /* ------------------------------ versions (#15) ------------------------------ */

    test("versions: create, list newest first with pagination, read, isolate by collection and document", async () => {
      const { createVersion, findVersions, findVersionById } = db;
      if (!createVersion || !findVersions || !findVersionById) throw new Error("adapter must implement versions");
      const add = (data: Record<string, unknown>, extra: Partial<VersionRecord> = {}) =>
        db.createVersion!({ collection: "posts", documentId: "doc-1", kind: "publish", slug: "hello", data, author: null, ...extra });
      const first = await add({ title: "v1" }, { author: { id: "u1", name: "Ada", email: "ada@example.com" } });
      const second = await add({ title: "v2" }, { kind: "draft" });
      const third = await add({ title: "v3" }, { kind: "restore", slug: null });
      await add({ title: "other doc" }, { documentId: "doc-2" });
      await db.createVersion!({ collection: "pages", documentId: "doc-1", kind: "publish", slug: null, data: {}, author: null });

      // Strictly increasing per document, even when written in the same millisecond.
      expect(second.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
      expect(third.createdAt.getTime()).toBeGreaterThan(second.createdAt.getTime());
      expect(first.author).toEqual({ id: "u1", name: "Ada", email: "ada@example.com" });

      const all = await db.findVersions!({ collection: "posts", documentId: "doc-1", limit: 0 });
      expect(all.docs.map((v) => v.data.title)).toEqual(["v3", "v2", "v1"]);
      expect(all.totalDocs).toBe(3);
      const page2 = await db.findVersions!({ collection: "posts", documentId: "doc-1", limit: 2, page: 2 });
      expect(page2.docs.map((v) => v.id)).toEqual([first.id]);
      expect(page2).toMatchObject({ totalDocs: 3, totalPages: 2, hasNextPage: false, hasPrevPage: true });

      expect(await db.findVersionById!("posts", second.id)).toEqual(second);
      expect(await db.findVersionById!("pages", second.id)).toBeNull();
      expect(third).toMatchObject({ kind: "restore", slug: null, data: { title: "v3" } });
    });

    test("deleteVersions keeps the newest N or removes all for one document", async () => {
      const add = (title: string, documentId = "doc-1") =>
        db.createVersion!({ collection: "posts", documentId, kind: "publish", slug: null, data: { title }, author: null });
      for (const title of ["v1", "v2", "v3", "v4"]) await add(title);
      await add("keep me", "doc-2");
      expect(await db.deleteVersions!("posts", "doc-1", { keep: 2 })).toBe(2);
      const left = await db.findVersions!({ collection: "posts", documentId: "doc-1", limit: 0 });
      expect(left.docs.map((v) => v.data.title)).toEqual(["v4", "v3"]);
      expect(await db.deleteVersions!("posts", "doc-1", { keep: 5 })).toBe(0);
      expect(await db.deleteVersions!("posts", "doc-1")).toBe(2);
      expect((await db.findVersions!({ collection: "posts", documentId: "doc-1" })).totalDocs).toBe(0);
      expect((await db.findVersions!({ collection: "posts", documentId: "doc-2" })).totalDocs).toBe(1);
    });

    test("full-text search matches tokens, prefixes, phrases, OR, negation, isolates drafts, and ranks by relevance", async () => {
      const rich = await create(
        { title: "PostgreSQL Full Text Search Guide", body: "PostgreSQL tsvector indexing guide" },
        { searchText: "PostgreSQL Full Text Search Guide PostgreSQL tsvector indexing guide" },
      );
      const intro = await create(
        { title: "Getting Started", body: "Intro to PostgreSQL databases" },
        { searchText: "Getting Started Intro to PostgreSQL databases" },
      );
      const changed = await create(
        { title: "Live Public Title", body: "Published content about astronomy" },
        {
          draftData: { title: "Secret Draft Rocket", body: "Unpublished rocket launch notes" },
          searchText: "Live Public Title Published content about astronomy",
          draftSearchText: "Secret Draft Rocket Unpublished rocket launch notes",
        },
      );
      const draftOnly = await create(
        {},
        {
          status: "draft",
          draftData: { title: "Draft Only Guide", body: "Pending manuscript" },
          searchText: null,
          draftSearchText: "Draft Only Guide Pending manuscript",
        },
      );
      // Direct adapter create without explicit searchText falls back to indexing string fields from data.
      const fallbackIndexed = await create({ title: "Fallback Aurora", notes: "Northern lights" });

      // Single-term search ranks higher-density document first.
      const ranked = await db.find({ collection: "posts", source: "published", search: "postgresql" });
      expect(ranked.docs.map((r) => r.id)).toEqual([rich.id, intro.id]);
      expect(ranked.totalDocs).toBe(2);

      // Multi-word AND + prefix match.
      expect((await db.find({ collection: "posts", source: "published", search: "postgresql guide" })).docs.map((r) => r.id)).toEqual([rich.id]);
      expect((await db.find({ collection: "posts", source: "published", search: "postgr" })).docs.map((r) => r.id)).toEqual([rich.id, intro.id]);

      // Quoted phrase, OR, and negation operators.
      expect((await db.find({ collection: "posts", source: "published", search: '"full text"' })).docs.map((r) => r.id)).toEqual([rich.id]);
      expect((await db.find({ collection: "posts", source: "published", search: '"text full"' })).totalDocs).toBe(0);
      expect((await db.find({ collection: "posts", source: "published", search: "astronomy OR tsvector" })).docs.map((r) => r.id).sort()).toEqual([rich.id, changed.id].sort());
      expect((await db.find({ collection: "posts", source: "published", search: "postgresql -guide" })).docs.map((r) => r.id)).toEqual([intro.id]);

      // Fallback indexing works when searchText wasn't passed explicitly.
      expect((await db.find({ collection: "posts", source: "published", search: "aurora" })).docs.map((r) => r.id)).toEqual([fallbackIndexed.id]);

      // Published vs draft isolation: pending draft text never leaks into published search.
      expect((await db.find({ collection: "posts", source: "published", search: "rocket" })).totalDocs).toBe(0);
      expect((await db.find({ collection: "posts", source: "published", search: "astronomy" })).docs.map((r) => r.id)).toEqual([changed.id]);
      expect((await db.find({ collection: "posts", source: "draft", search: "rocket" })).docs.map((r) => r.id)).toEqual([changed.id]);
      expect((await db.find({ collection: "posts", source: "draft", search: "astronomy" })).totalDocs).toBe(0);
      expect((await db.find({ collection: "posts", source: "draft", search: "manuscript" })).docs.map((r) => r.id)).toEqual([draftOnly.id]);
      expect((await db.find({ collection: "posts", source: "published", search: "manuscript" })).totalDocs).toBe(0);

      // Explicit sort overrides relevance ordering.
      const sorted = await db.find({ collection: "posts", source: "published", search: "postgresql", sort: "title" });
      expect(sorted.docs.map((r) => r.id)).toEqual([intro.id, rich.id]);

      // Whitespace-only is ignored; punctuation-only safely returns 0 results without throwing.
      expect((await db.find({ collection: "posts", source: "published", search: "   " })).totalDocs).toBe(4);
      expect((await db.find({ collection: "posts", source: "published", search: "!!! --- ???" })).totalDocs).toBe(0);

      // Updating searchText refreshes the index immediately; deleting removes it.
      await db.update("posts", changed.id, {
        data: { title: "Secret Draft Rocket", body: "Now live rocket notes" },
        draftData: null,
        searchText: "Secret Draft Rocket Now live rocket notes",
        draftSearchText: null,
      });
      expect((await db.find({ collection: "posts", source: "published", search: "rocket" })).docs.map((r) => r.id)).toEqual([changed.id]);
      expect((await db.find({ collection: "posts", source: "published", search: "astronomy" })).totalDocs).toBe(0);

      await db.delete("posts", intro.id);
      expect((await db.find({ collection: "posts", source: "published", search: "databases" })).totalDocs).toBe(0);
    });
  });
}
