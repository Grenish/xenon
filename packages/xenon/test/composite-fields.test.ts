import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryAdapter } from "../src/adapters/memory";
import {
  array,
  blocks,
  boolean,
  date,
  datetime,
  defineBlock,
  defineCollection,
  defineConfig,
  email,
  group,
  json,
  number,
  relation,
  select,
  text,
  url,
  validateCollectionData,
  validateFieldValue,
  XenonConfigError,
} from "../src/index";
import type { ValidationResult } from "../src/index";
import { withReadDefaults } from "../src/core/defaults";
import { createXenon } from "../src/server/xenon";
import { toClientCollection } from "../src/ui/shared/client-config";

function issues(result: ValidationResult<unknown>) {
  return result.success ? [] : result.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("date / datetime", () => {
  test("date accepts real calendar days only", () => {
    const f = date();
    expect(validateFieldValue(f, "2026-02-28")).toBeNull();
    expect(validateFieldValue(f, "2024-02-29")).toBeNull();
    expect(validateFieldValue(f, "2026-02-29")).toBe("Expected a date (YYYY-MM-DD)");
    expect(validateFieldValue(f, "2026-13-01")).not.toBeNull();
    expect(validateFieldValue(f, "2026-11-25T00:00:00Z")).not.toBeNull();
  });

  test("datetime normalizes to UTC ISO strings", () => {
    const c = defineCollection({ slug: "events", fields: { at: datetime({ required: true }) } });
    const r = validateCollectionData(c, { at: "2026-11-25T10:30:00+05:30" }, { mode: "create" });
    expect(r.success && r.data.at).toBe("2026-11-25T05:00:00.000Z");
    expect(issues(validateCollectionData(c, { at: "2026-11-25 10:30" }, { mode: "create" }))).toEqual([
      "at: Expected an ISO-8601 date and time",
    ]);
    // A timestamp without an offset is ambiguous.
    expect(validateFieldValue(datetime(), "2026-11-25T10:30:00")).not.toBeNull();
  });

  test("min / max bounds", () => {
    const f = date({ min: "2026-01-01", max: "2026-12-31" });
    expect(validateFieldValue(f, "2026-06-01")).toBeNull();
    expect(validateFieldValue(f, "2025-12-31")).toBe("Must be on or after 2026-01-01");
    expect(validateFieldValue(f, "2027-01-01")).toBe("Must be on or before 2026-12-31");
    const t = datetime({ min: "2026-11-25T00:00:00Z" });
    expect(validateFieldValue(t, "2026-11-25T05:29:59+05:30")).not.toBeNull();
    expect(validateFieldValue(t, "2026-11-25T05:30:00+05:30")).toBeNull();
  });
});

describe("email / url", () => {
  test("email", () => {
    expect(validateFieldValue(email(), "ada@example.com")).toBeNull();
    expect(validateFieldValue(email(), "not-an-email")).toBe("Expected an email address");
  });

  test("url allows http(s) only by default", () => {
    expect(validateFieldValue(url(), "https://example.com/a?b=1")).toBeNull();
    expect(validateFieldValue(url(), "javascript:alert(1)")).toBe("URL must start with http: or https:");
    expect(validateFieldValue(url(), "/relative")).toBe("Expected a URL");
    expect(validateFieldValue(url({ protocols: ["mailto"] }), "mailto:ada@example.com")).toBeNull();
    expect(validateFieldValue(url({ protocols: ["mailto"] }), "https://example.com")).not.toBeNull();
  });
});

describe("json", () => {
  test("accepts plain JSON, rejects non-JSON values", () => {
    const f = json();
    expect(validateFieldValue(f, { a: [1, "two", null, { b: true }] })).toBeNull();
    expect(validateFieldValue(f, "text")).toBeNull();
    expect(validateFieldValue(f, { at: new Date() })).toBe("Expected a JSON value");
    expect(validateFieldValue(f, { n: Number.NaN })).toBe("Expected a JSON value");
    expect(validateFieldValue(f, { u: undefined })).toBe("Expected a JSON value");
  });

  test("validates and transforms with a Standard Schema", () => {
    const c = defineCollection({
      slug: "things",
      fields: { meta: json({ schema: z.object({ count: z.number().int(), tag: z.string().default("x") }) }) },
    });
    const ok = validateCollectionData(c, { meta: { count: 2 } }, { mode: "create" });
    expect(ok.success && ok.data.meta).toEqual({ count: 2, tag: "x" });
    expect(issues(validateCollectionData(c, { meta: { count: 1.5 } }, { mode: "create" }))).toEqual([
      "meta.count: Invalid input: expected int, received number",
    ]);
  });
});

describe("boolean display", () => {
  test("admin.display reaches the client config", () => {
    const c = defineCollection({ slug: "flags", fields: { on: boolean({ admin: { display: "checkbox" } }) } });
    expect(toClientCollection(c).fields[0]!.admin.display).toBe("checkbox");
  });
});

const seo = group({
  label: "SEO",
  fields: {
    title: text({ maxLength: 60 }),
    noIndex: boolean({ defaultValue: false }),
  },
});

const hero = defineBlock({
  slug: "hero",
  fields: { heading: text({ required: true }), cta: url() },
});
const quote = defineBlock({
  slug: "quote",
  fields: { body: text({ required: true }), author: text() },
});

const pages = defineCollection({
  slug: "pages",
  fields: {
    title: text({ required: true }),
    seo,
    address: group({ fields: { city: text({ required: true }), zip: text() } }),
    links: array({ fields: { label: text({ required: true }), href: url({ required: true }) }, maxRows: 3 }),
    tags: array({ fields: { name: text() }, required: true }),
    layout: blocks({ blocks: [hero, quote] }),
  },
});

describe("group", () => {
  test("defaults apply inside groups and nested required fields are enforced", () => {
    const r = validateCollectionData(pages, { title: "Home", address: { city: "Pokhara" }, tags: [{ name: "a" }] }, { mode: "create" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.seo).toEqual({ noIndex: false });
    expect(r.data.links).toEqual([]);
    expect(r.data.layout).toEqual([]);

    expect(issues(validateCollectionData(pages, { title: "Home", tags: [{}] }, { mode: "create" }))).toEqual([
      "address.city: This field is required",
    ]);
  });

  test("unknown nested keys are rejected; drafts are lenient", () => {
    expect(issues(validateCollectionData(pages, { title: "x", address: { city: "a", extra: 1 }, tags: [{}] }, { mode: "create" }))).toEqual([
      'address: Unrecognized key: "extra"',
    ]);
    expect(validateCollectionData(pages, { address: {} }, { mode: "draft" }).success).toBe(true);
  });

  test("custom validate receives sibling data", () => {
    const c = defineCollection({
      slug: "ranges",
      fields: {
        range: group({
          fields: {
            from: number(),
            to: number({ validate: (v, { data }) => (typeof data.from === "number" && v < data.from ? "to must be ≥ from" : true) }),
          },
        }),
      },
    });
    expect(issues(validateCollectionData(c, { range: { from: 5, to: 2 } }, { mode: "create" }))).toEqual(["range.to: to must be ≥ from"]);
  });
});

describe("array", () => {
  test("assigns row ids, keeps given ones, and reports nested paths", () => {
    const r = validateCollectionData(
      pages,
      { title: "x", address: { city: "a" }, tags: [{ name: "t" }], links: [{ id: "keep", label: "A", href: "https://a.dev" }, { label: "B", href: "https://b.dev" }] },
      { mode: "create" },
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.links![0]!.id).toBe("keep");
    expect(r.data.links![1]!.id).toMatch(/^[0-9a-f]{16}$/);

    expect(issues(validateCollectionData(pages, { title: "x", address: { city: "a" }, tags: [{}], links: [{ label: "A", href: "ftp://x" }] }, { mode: "create" }))).toEqual([
      "links.0.href: URL must start with http: or https:",
    ]);
  });

  test("required / maxRows / duplicate ids", () => {
    expect(issues(validateCollectionData(pages, { title: "x", address: { city: "a" }, tags: [] }, { mode: "create" }))).toEqual([
      "tags: This field is required",
    ]);
    const link = { label: "A", href: "https://a.dev" };
    expect(issues(validateCollectionData(pages, { title: "x", address: { city: "a" }, tags: [{}], links: [link, link, link, link] }, { mode: "create" }))).toEqual([
      "links: Use 3 items or fewer",
    ]);
    expect(issues(validateCollectionData(pages, { title: "x", address: { city: "a" }, tags: [{ id: "a" }, { id: "a" }] }, { mode: "create" }))).toEqual([
      "tags.1.id: Duplicate row id",
    ]);
    // Drafts skip minimums.
    expect(validateCollectionData(pages, { tags: [] }, { mode: "draft" }).success).toBe(true);
  });
});

describe("blocks", () => {
  test("validates each item against its block type", () => {
    const r = validateCollectionData(
      pages,
      {
        title: "x",
        address: { city: "a" },
        tags: [{}],
        layout: [{ blockType: "hero", heading: "Hi" }, { blockType: "quote", body: "…", author: "Ada" }],
      },
      { mode: "create" },
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.layout!.map((b) => b.blockType)).toEqual(["hero", "quote"]);

    expect(issues(validateCollectionData(pages, { title: "x", address: { city: "a" }, tags: [{}], layout: [{ blockType: "video" }, { blockType: "hero", body: "x" }] }, { mode: "create" }))).toEqual([
      "layout.0.blockType: Expected one of: hero, quote",
      "layout.1.heading: This field is required",
      'layout.1: Unrecognized key: "body"',
    ]);
  });
});

describe("read defaults", () => {
  test("fill containers and nested defaults without touching stored values", () => {
    const stored = { title: "x", links: [{ id: "r1", label: "A", href: "https://a.dev" }], layout: [{ id: "b1", blockType: "hero", heading: "Hi" }], removed: 1 };
    expect(withReadDefaults(pages.fields, stored)).toEqual({
      title: "x",
      seo: { noIndex: false },
      address: {},
      links: [{ id: "r1", label: "A", href: "https://a.dev" }],
      tags: [],
      layout: [{ id: "b1", blockType: "hero", heading: "Hi" }],
    });
  });
});

describe("config validation", () => {
  const bad = (fields: Record<string, unknown>) => () =>
    defineConfig({ collections: [defineCollection({ slug: "c", fields: fields as never })] });

  test("nested reserved keys and empty containers", () => {
    expect(bad({ rows: array({ fields: { id: text() } }) })).toThrow(/"id" is reserved here/);
    expect(bad({ g: group({ fields: {} }) })).toThrow(/needs at least one field/);
    expect(bad({ g: group({ fields: { "a.b": text() } }) })).toThrow(/cannot contain "."/);
    expect(bad({ b: blocks({ blocks: [defineBlock({ slug: "x", fields: { blockType: text() } })] }) })).toThrow(XenonConfigError);
  });

  test("blocks, rows and date bounds", () => {
    expect(bad({ b: blocks({ blocks: [] }) })).toThrow(/at least one block/);
    const x = defineBlock({ slug: "x", fields: { a: text() } });
    expect(bad({ b: blocks({ blocks: [x, x] }) })).toThrow(/duplicate block slug "x"/);
    expect(bad({ a: array({ fields: { a: text() }, minRows: 3, maxRows: 1 }) })).toThrow(/minRows \(3\) is greater/);
    expect(bad({ d: date({ min: "2026-02-30" }) })).toThrow(/min "2026-02-30" is not a valid/);
  });

  test("nested relations are checked against the collection graph", () => {
    expect(bad({ g: group({ fields: { author: relation({ relationTo: "nope" }) } }) })).toThrow(/c" → field "g.author"/);
  });

  test("defaults inside containers are validated", () => {
    expect(bad({ g: group({ fields: { s: select({ options: ["a"], defaultValue: "b" as never }) } }) })).toThrow(/invalid defaultValue/);
  });
});

describe("Local API round trip", () => {
  test("composite values are stored and read back with defaults", async () => {
    const xenon = createXenon(defineConfig({ collections: [pages], db: memoryAdapter() }));
    const created = await xenon.create({
      collection: "pages",
      overrideAccess: true,
      data: { title: "Home", address: { city: "Pokhara" }, tags: [{ name: "a" }], layout: [{ blockType: "quote", body: "Hi" }] },
    });
    expect(created.seo).toEqual({ noIndex: false });
    expect(created.layout[0]).toMatchObject({ blockType: "quote", body: "Hi" });
    const layoutId = created.layout[0]!.id;

    const updated = await xenon.update({
      collection: "pages",
      id: created.id,
      overrideAccess: true,
      data: { seo: { title: "Welcome" } },
    });
    expect(updated.seo).toEqual({ title: "Welcome", noIndex: false });
    expect(updated.layout[0]!.id).toBe(layoutId);
  });
});

describe("partial updates", () => {
  const settings = defineCollection({
    slug: "settings",
    fields: {
      title: text(),
      seo: group({
        fields: {
          title: text(),
          noIndex: boolean({ defaultValue: false }),
          og: group({ fields: { image: url(), alt: text() } }),
        },
      }),
      links: array({ fields: { label: text() } }),
      meta: json(),
      layout: blocks({ blocks: [hero, quote] }),
    },
  });
  const setup = async () => {
    const db = memoryAdapter();
    const xenon = createXenon(defineConfig({ collections: [settings], db }));
    const doc = await xenon.create({
      collection: "settings",
      overrideAccess: true,
      data: {
        title: "Site",
        seo: { title: "Home", og: { image: "https://img.dev/a.png", alt: "A" } },
        links: [{ label: "one" }, { label: "two" }],
        meta: { a: 1, b: 2 },
      },
    });
    return { db, xenon, doc };
  };

  test("groups merge recursively instead of replacing", async () => {
    const { xenon, doc } = await setup();
    const updated = await xenon.update({ collection: "settings", id: doc.id, overrideAccess: true, data: { seo: { noIndex: true, og: { alt: "B" } } } });
    expect(updated.seo).toEqual({ title: "Home", noIndex: true, og: { image: "https://img.dev/a.png", alt: "B" } });
    expect(updated.title).toBe("Site");
  });

  test("null clears one nested value; null on a group resets it to defaults", async () => {
    const { xenon, doc } = await setup();
    const cleared = await xenon.update({ collection: "settings", id: doc.id, overrideAccess: true, data: { seo: { title: null } } });
    expect(cleared.seo).toEqual({ title: null, noIndex: false, og: { image: "https://img.dev/a.png", alt: "A" } });
    const reset = await xenon.update({ collection: "settings", id: doc.id, overrideAccess: true, data: { seo: null } });
    expect(reset.seo).toEqual({ noIndex: false, og: {} });
  });

  test("arrays and json are replaced wholesale", async () => {
    const { xenon, doc } = await setup();
    const updated = await xenon.update({ collection: "settings", id: doc.id, overrideAccess: true, data: { links: [{ label: "only" }], meta: { c: 3 } } });
    expect(updated.links.map((l) => l.label)).toEqual(["only"]);
    expect(updated.meta).toEqual({ c: 3 });
  });

  test("drafts merge against the working copy", async () => {
    const { xenon, doc } = await setup();
    await xenon.update({ collection: "settings", id: doc.id, draft: true, overrideAccess: true, data: { seo: { title: "Draft title" } } });
    const draft = await xenon.update({ collection: "settings", id: doc.id, draft: true, overrideAccess: true, data: { seo: { noIndex: true } } });
    expect(draft.seo).toMatchObject({ title: "Draft title", noIndex: true });
    const live = await xenon.findById({ collection: "settings", id: doc.id, overrideAccess: true });
    expect(live!.seo.title).toBe("Home");
  });

  test("documents written under an older schema still update (removed nested fields and block types)", async () => {
    const { db, xenon, doc } = await setup();
    const record = (await db.findById("settings", doc.id))!;
    await db.update("settings", doc.id, {
      data: {
        ...record.data,
        seo: { ...(record.data.seo as object), removedField: "x" },
        links: [{ id: "r1", label: "kept", gone: true }],
        layout: [{ id: "b1", blockType: "hero", heading: "Hi", oldProp: 1 }, { id: "b2", blockType: "deletedType", x: 1 }],
      },
    });
    const read = await xenon.findById({ collection: "settings", id: doc.id, overrideAccess: true });
    expect(read!.layout.map((b) => b.id)).toEqual(["b1"]);
    const updated = await xenon.update({ collection: "settings", id: doc.id, overrideAccess: true, data: { title: "Renamed" } });
    expect(updated.title).toBe("Renamed");
    expect(updated.seo).not.toHaveProperty("removedField");
    expect(updated.links).toEqual([{ id: "r1", label: "kept" }]);
    expect(updated.layout).toEqual([{ id: "b1", blockType: "hero", heading: "Hi" }]);
  });
});
