import { afterAll, describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { memoryAdapter } from "../../src/adapters/memory";
import { pgliteAdapter } from "../../src/adapters/postgres/pglite";
import { compileOrderBy, compileWhere } from "../../src/adapters/postgres/where";
import type { DatabaseAdapter } from "../../src/adapters/types";
import { boolean, defineCollection, defineConfig, text } from "../../src/index";
import type { XenonChangeEvent } from "../../src/server/types";
import { createXenon, slugify } from "../../src/server/xenon";

/* Regression tests for audit Medium #12, #13, #14, #15, #17, #18 (fix/audit-bugs). */

const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  fields: { title: text({ required: true }), featured: boolean() },
});

const pglite = pgliteAdapter();
afterAll(async () => { await (pglite as { close?: () => Promise<void> }).close?.(); });

const adapters: [string, () => DatabaseAdapter][] = [
  ["memory", () => memoryAdapter()],
  ["pglite", () => pglite],
];

async function freshPglite() {
  await pglite.init();
  for (const collection of ["posts", "flags"]) {
    const { docs } = await pglite.find({ collection, source: "draft", limit: 0 });
    for (const doc of docs) await pglite.delete(collection, doc.id);
  }
}

for (const [name, make] of adapters) {
  describe(`${name}: adapter parity`, () => {
    async function adapter() {
      if (name === "pglite") await freshPglite();
      const db = make();
      await db.init();
      return db;
    }

    test("#12 sorting by a boolean field orders false before true (and reverses)", async () => {
      const db = await adapter();
      for (const [title, featured] of [["a", true], ["b", false], ["c", true], ["d", false]] as const) {
        await db.create({ collection: "posts", slug: title, status: "published", data: { title, featured }, draftData: null });
      }
      const asc = await db.find({ collection: "posts", source: "published", sort: "featured", limit: 0 });
      const desc = await db.find({ collection: "posts", source: "published", sort: "-featured", limit: 0 });
      expect(asc.docs.map((d) => d.data.featured)).toEqual([false, false, true, true]);
      expect(desc.docs.map((d) => d.data.featured)).toEqual([true, true, false, false]);
    });

    test("#13 timestamp filters accept any offset / precision", async () => {
      const db = await adapter();
      const doc = await db.create({ collection: "posts", slug: null, status: "published", data: { title: "x" }, draftData: null });
      const at = doc.createdAt;
      const pad = (n: number) => String(n).padStart(2, "0");
      // Same instant written at +05:30.
      const shifted = new Date(at.getTime() + 330 * 60_000);
      const offset = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}.${String(at.getUTCMilliseconds()).padStart(3, "0")}+05:30`;
      const count = async (where: object) => (await db.find({ collection: "posts", source: "published", where: where as never })).totalDocs;
      expect(await count({ createdAt: { equals: offset } })).toBe(1);
      expect(await count({ createdAt: { in: [offset] } })).toBe(1);
      // No milliseconds: one second floor is still <= the stored instant.
      const floor = new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString().replace(".000Z", "Z");
      expect(await count({ createdAt: { gte: floor } })).toBe(1);
      expect(await count({ createdAt: { lt: floor } })).toBe(0);
      // Unparseable operands match nothing (and their negation everything), like PostgreSQL.
      expect(await count({ createdAt: { equals: "not a date" } })).toBe(0);
      expect(await count({ createdAt: { not_equals: "not a date" } })).toBe(1);
      expect(await count({ createdAt: { gt: "not a date" } })).toBe(0);
    });
  });
}

describe("#14 published equality uses jsonb containment (GIN-indexable)", () => {
  const dialect = new PgDialect();
  const render = (where: object, source: "published" | "draft") => dialect.sqlToQuery(compileWhere(where as never, source));

  test("scalar equals / in on published data compile to @>", () => {
    const eq = render({ featured: { equals: true } }, "published");
    expect(eq.sql).toContain("@>");
    expect(eq.params).toContain(JSON.stringify({ featured: true }));
    const inList = render({ title: { in: ["a", "b"] } }, "published");
    expect(inList.sql.match(/@>/g)?.length).toBe(2);
  });

  test("drafts, arrays/objects and null keep the exact equality form", () => {
    expect(render({ featured: { equals: true } }, "draft").sql).not.toContain("@>");
    expect(render({ tags: { equals: ["a"] } }, "published").sql).not.toContain("@>");
    expect(render({ title: { equals: null } }, "published").sql).not.toContain("@>");
  });

  test("orderBy includes a boolean branch", () => {
    expect(dialect.sqlToQuery(compileOrderBy("featured", "published")).sql).toContain("'boolean'");
  });

  test("containment matches exactly the rows equality would (pglite)", async () => {
    await freshPglite();
    for (const [title, featured] of [["a", true], ["b", false]] as const) {
      await pglite.create({ collection: "posts", slug: null, status: "published", data: { title, featured, tags: [title] }, draftData: null });
    }
    // A nested array never "contains" a bare scalar.
    const tagged = await pglite.find({ collection: "posts", source: "published", where: { tags: { equals: "a" } } });
    expect(tagged.totalDocs).toBe(0);
    const featured = await pglite.find({ collection: "posts", source: "published", where: { featured: { equals: true } } });
    expect(featured.docs.map((d) => d.data.title)).toEqual(["a"]);
    const either = await pglite.find({ collection: "posts", source: "published", where: { title: { in: ["a", "b", "zz"] } } });
    expect(either.totalDocs).toBe(2);
  });
});

describe("#15 draft saves only expire the document's own cache tag", () => {
  test("onChange reports draft: true for draft writes, false for publishing writes", async () => {
    const events: XenonChangeEvent[] = [];
    const xenon = createXenon(defineConfig({ collections: [posts], db: memoryAdapter() }), { onChange: (e) => { events.push(e); } });
    const created = await xenon.create({ collection: "posts", data: { title: "Draft" }, draft: true });
    await xenon.update({ collection: "posts", id: created.id, data: { title: "Still draft" }, draft: true });
    await xenon.update({ collection: "posts", id: created.id, data: { title: "Live" } });
    await xenon.unpublish({ collection: "posts", id: created.id });
    await xenon.delete({ collection: "posts", id: created.id });
    expect(events.map((e) => [e.op, e.draft])).toEqual([
      ["create", true], ["update", true], ["update", false], ["unpublish", false], ["delete", false],
    ]);
  });
});

describe("#17 where filters agree with defaultValue on documents saved before the field existed", () => {
  const before = defineCollection({ slug: "flags", fields: { title: text() } });
  const after = defineCollection({ slug: "flags", fields: { title: text(), featured: boolean({ defaultValue: false }) } });

  for (const [name, make] of adapters) {
    test(name, async () => {
      if (name === "pglite") await freshPglite();
      const db = make();
      const old = createXenon(defineConfig({ collections: [before], db }));
      await old.create({ collection: "flags", data: { title: "old" } });
      const xenon = createXenon(defineConfig({ collections: [after], db }));
      await xenon.create({ collection: "flags", data: { title: "on", featured: true } });
      await xenon.create({ collection: "flags", data: { title: "off", featured: false } });

      const titles = async (where: object) =>
        (await xenon.find({ collection: "flags", where: where as never, sort: "title" })).docs.map((d) => d.title).sort();
      // Reads report the default…
      expect((await xenon.find({ collection: "flags", where: { title: { equals: "old" } } })).docs[0]?.featured).toBe(false);
      // …and filters now agree.
      expect(await titles({ featured: { equals: false } })).toEqual(["off", "old"]);
      expect(await titles({ featured: { not_equals: false } })).toEqual(["on"]);
      expect(await titles({ featured: { equals: true } })).toEqual(["on"]);
      expect(await titles({ featured: { not_equals: true } })).toEqual(["off", "old"]);
      expect(await titles({ featured: { in: [false] } })).toEqual(["off", "old"]);
      expect(await titles({ featured: { exists: true } })).toEqual(["off", "old", "on"]);
      expect(await titles({ featured: { exists: false } })).toEqual([]);
      expect(await titles({ or: [{ featured: { equals: false } }, { title: { equals: "on" } }] })).toEqual(["off", "old", "on"]);
    });
  }
});

describe("#18 slugs", () => {
  test("non-Latin titles keep their letters; Latin diacritics still fold", () => {
    expect(slugify("日本語のタイトル")).toBe("日本語のタイトル");
    expect(slugify("がぎぐ")).toBe("がぎぐ");
    expect(slugify("Привет, мир!")).toBe("привет-мир");
    expect(slugify("हिन्दी लेख")).toBe("हिन्दी-लेख");
    expect(slugify("Café au lait")).toBe("cafe-au-lait");
    expect(slugify("Hello, World! 2026")).toBe("hello-world-2026");
    expect(slugify("🎉🎉")).toBe("");
    // Capped at 96 code points without splitting a surrogate pair.
    const capped = slugify("𠀀".repeat(120));
    expect(Array.from(capped).length).toBe(96);
    expect(capped).toBe("𠀀".repeat(96));
  });

  test("uniqueSlug picks the first free suffix in one pass, ignoring look-alikes", async () => {
    const xenon = createXenon(defineConfig({ collections: [posts], db: memoryAdapter() }));
    const slugs: (string | null)[] = [];
    for (const title of ["Hello", "Hello", "Hello-world", "Hello", "Hello"]) {
      slugs.push((await xenon.create({ collection: "posts", data: { title } })).slug);
    }
    expect(slugs).toEqual(["hello", "hello-2", "hello-world", "hello-3", "hello-4"]);
    expect((await xenon.create({ collection: "posts", data: { title: "日本語" } })).slug).toBe("日本語");
  });

  for (const [name, make] of adapters) {
    test(`${name}: concurrent creates with the same title all succeed with distinct slugs`, async () => {
      if (name === "pglite") await freshPglite();
      const xenon = createXenon(defineConfig({ collections: [posts], db: make() }));
      const docs = await Promise.all(Array.from({ length: 3 }, () => xenon.create({ collection: "posts", data: { title: "Race" } })));
      expect(new Set(docs.map((d) => d.slug)).size).toBe(3);
    });
  }
});
