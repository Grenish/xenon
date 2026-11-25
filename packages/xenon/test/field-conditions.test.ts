import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "../src/adapters/memory";
import {
  array,
  blocks,
  boolean,
  defineBlock,
  defineCollection,
  defineConfig,
  evaluateCondition,
  number,
  select,
  text,
  url,
  validateCollectionData,
} from "../src/index";
import type { ValidationResult } from "../src/index";
import { createXenon } from "../src/server/xenon";
import { toClientCollection } from "../src/ui/shared/client-config";
import { validateFields } from "../src/ui/form/model";

function issues(result: ValidationResult<unknown>) {
  return result.success ? [] : result.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("evaluateCondition", () => {
  test("where operators against sibling data", () => {
    const data = { type: "video", views: 10, tags: ["a", "b"], title: "Hello world", empty: null };
    expect(evaluateCondition({ type: { equals: "video" } }, data)).toBe(true);
    expect(evaluateCondition({ type: { not_equals: "video" } }, data)).toBe(false);
    expect(evaluateCondition({ type: { in: ["image", "video"] } }, data)).toBe(true);
    expect(evaluateCondition({ views: { gte: 10, lt: 11 } }, data)).toBe(true);
    expect(evaluateCondition({ tags: { contains: "b" } }, data)).toBe(true);
    expect(evaluateCondition({ title: { contains: "WORLD" } }, data)).toBe(true);
    expect(evaluateCondition({ empty: { exists: false } }, data)).toBe(true);
    expect(evaluateCondition({ missing: { exists: false } }, data)).toBe(true);
    expect(evaluateCondition({ missing: { exists: true } }, data)).toBe(false);
  });

  test("and / or, and multiple keys mean all", () => {
    const data = { type: "video", featured: true };
    expect(evaluateCondition({ type: { equals: "video" }, featured: { equals: false } }, data)).toBe(false);
    expect(evaluateCondition({ or: [{ type: { equals: "image" } }, { featured: { equals: true } }] }, data)).toBe(true);
    expect(evaluateCondition({ and: [{ type: { equals: "video" } }, { or: [{ featured: { equals: false } }] }] }, data)).toBe(false);
  });
});

const media = defineCollection({
  slug: "media-items",
  fields: {
    kind: select({ options: ["image", "video"], required: true }),
    videoUrl: url({ required: true, admin: { condition: { kind: { equals: "video" } } } }),
    caption: text({
      admin: { condition: { kind: { equals: "image" } } },
      validate: (v) => (v.length > 3 ? true : "Caption too short"),
    }),
    duration: number({ min: 1, admin: { condition: { kind: { equals: "video" } } } }),
  },
});

describe("server validation", () => {
  test("shown fields follow their rules; hidden ones skip required and custom validate", () => {
    expect(issues(validateCollectionData(media, { kind: "video" }, { mode: "create" }))).toEqual(["videoUrl: This field is required"]);
    expect(validateCollectionData(media, { kind: "image" }, { mode: "create" }).success).toBe(true);
    // Hidden fields keep their value, and custom validate doesn't run on them...
    const kept = validateCollectionData(media, { kind: "video", videoUrl: "https://v.dev/1", caption: "x" }, { mode: "create" });
    expect(kept.success && kept.data.caption).toBe("x");
    // ...but runs when shown.
    expect(issues(validateCollectionData(media, { kind: "image", caption: "x" }, { mode: "create" }))).toEqual(["caption: Caption too short"]);
  });

  test("hidden values are still type- and format-checked", () => {
    expect(issues(validateCollectionData(media, { kind: "image", videoUrl: "javascript:alert(1)" }, { mode: "create" }))).toEqual([
      "videoUrl: URL must start with http: or https:",
    ]);
    expect(issues(validateCollectionData(media, { kind: "image", duration: "long" }, { mode: "create" }))).toEqual([
      "duration: Invalid input: expected number, received string",
    ]);
  });

  test("unknown keys are still rejected and errors from both passes are reported together", () => {
    expect(issues(validateCollectionData(media, { kind: "video", nope: 1 }, { mode: "create" }))).toEqual([
      ': Unrecognized key: "nope"',
      "videoUrl: This field is required",
    ]);
  });

  test("conditions inside blocks and array rows look at their own siblings", () => {
    const cta = defineBlock({
      slug: "cta",
      fields: {
        style: select({ options: ["link", "button"], defaultValue: "link" }),
        buttonColor: text({ required: true, admin: { condition: { style: { equals: "button" } } } }),
      },
    });
    const pages = defineCollection({
      slug: "pages",
      fields: {
        layout: blocks({ blocks: [cta] }),
        links: array({ fields: { external: boolean({ defaultValue: false }), href: url({ required: true, admin: { condition: { external: { equals: true } } } }) } }),
      },
    });
    expect(issues(validateCollectionData(pages, {
      layout: [{ blockType: "cta" }, { blockType: "cta", style: "button" }],
      links: [{}, { external: true }],
    }, { mode: "create" }))).toEqual(["layout.1.buttonColor: This field is required", "links.1.href: This field is required"]);
  });

  test("Local API enforces conditions on create and update", async () => {
    const xenon = createXenon(defineConfig({ collections: [media], db: memoryAdapter() }));
    const doc = await xenon.create({ collection: "media-items", overrideAccess: true, data: { kind: "image" } });
    await expect(xenon.update({ collection: "media-items", id: doc.id, overrideAccess: true, data: { kind: "video" } })).rejects.toMatchObject({
      code: "VALIDATION",
      issues: [{ path: ["videoUrl"], message: "This field is required" }],
    });
    const ok = await xenon.update({ collection: "media-items", id: doc.id, overrideAccess: true, data: { kind: "video", videoUrl: "https://v.dev/1" } });
    expect(ok.videoUrl).toBe("https://v.dev/1");
  });
});

describe("config validation", () => {
  const bad = (fields: Record<string, unknown>) => () =>
    defineConfig({ collections: [defineCollection({ slug: "c", fields: fields as never })] });

  test("conditions must reference siblings with known operators", () => {
    expect(bad({ a: text(), b: text({ admin: { condition: { nope: { equals: 1 } } } }) })).toThrow(/"nope" is not a sibling field/);
    expect(bad({ a: text({ admin: { condition: { a: { exists: true } } } }) })).toThrow(/cannot depend on itself/);
    expect(bad({ a: text(), b: text({ admin: { condition: { a: { like: "x" } as never } } }) })).toThrow(/unknown operator "like"/);
    expect(bad({ a: text(), b: text({ admin: { condition: { a: { in: "x" as never } } } }) })).toThrow(/"in" on "a" needs an array/);
    expect(bad({ a: text(), b: text({ admin: { condition: { or: [] } } }) })).toThrow(/non-empty array/);
    expect(bad({ a: text(), b: text({ admin: { condition: { a: { equals: new Date() as never } } } }) })).toThrow(/plain JSON/);
  });

  test("valid conditions pass", () => {
    expect(bad({ a: text(), b: text({ admin: { condition: { or: [{ a: { exists: true } }, { a: { equals: "x" } }] } } }) })).not.toThrow();
  });
});

describe("admin", () => {
  test("conditions reach the client config and client validation mirrors the server", () => {
    const client = toClientCollection(media);
    expect(client.fields.find((f) => f.name === "videoUrl")!.admin.condition).toEqual({ kind: { equals: "video" } });
    expect(validateFields(client.fields, { kind: "video" }, false)).toEqual({ videoUrl: "Video url is required." });
    expect(validateFields(client.fields, { kind: "image" }, false)).toEqual({});
    expect(validateFields(client.fields, { kind: "image", videoUrl: "nope" }, false)).toEqual({ videoUrl: "Enter a full URL, like https://example.com." });
  });
});
