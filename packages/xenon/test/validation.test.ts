import { describe, expect, test } from "bun:test";
import {
  boolean,
  buildCollectionSchema,
  defineCollection,
  media,
  number,
  relation,
  richText,
  select,
  text,
  textarea,
  validateCollectionData,
} from "../src/index";
import type { InferCreateInput, RichTextDocument, ValidationResult } from "../src/index";

type Mode = "create" | "update" | "draft";

const posts = defineCollection({
  slug: "posts",
  fields: {
    title: text({ required: true, minLength: 2, maxLength: 10 }),
    requiredDefault: text({ required: true, defaultValue: "hello" }),
    featured: boolean({ defaultValue: false }),
    description: textarea(),
  },
});

function expectIssue(
  result: ValidationResult<unknown>,
  path: (string | number)[],
  message?: string,
) {
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected validation failure");
  expect(result.issues.length).toBeGreaterThan(0);
  const issue = result.issues.find((entry) => JSON.stringify(entry.path) === JSON.stringify(path));
  expect(issue).toBeDefined();
  expect(typeof issue?.message).toBe("string");
  if (message) expect(issue?.message).toContain(message);
}

describe("validation modes", () => {
  test("create requires fields and applies defaults to omitted values", () => {
    expectIssue(validateCollectionData(posts, {}, { mode: "create" }), ["title"]);
    expect(validateCollectionData(posts, { title: "Hello" }, { mode: "create" })).toEqual({
      success: true,
      data: { title: "Hello", requiredDefault: "hello", featured: false },
    });
  });

  test("explicit undefined gets create defaults", () => {
    expect(validateCollectionData(posts, {
      title: "Hello", requiredDefault: undefined, featured: undefined,
    }, { mode: "create" })).toEqual({
      success: true, data: { title: "Hello", requiredDefault: "hello", featured: false },
    });
  });

  test("create defaults do not replace supplied values or non-defaulted optional null", () => {
    expect(validateCollectionData(posts, {
      title: "Hello", requiredDefault: "custom", featured: true, description: null,
    }, { mode: "create" })).toEqual({
      success: true, data: { title: "Hello", requiredDefault: "custom", featured: true, description: null },
    });
    expect(validateCollectionData(posts, { title: "Hello", featured: null }, { mode: "create" })).toEqual({
      success: true, data: { title: "Hello", requiredDefault: "hello", featured: false },
    });
  });

  test("update accepts an empty object without adding defaults", () => {
    expect(validateCollectionData(posts, {}, { mode: "update" })).toEqual({ success: true, data: {} });
    expect(validateCollectionData(posts, { description: "A change" }, { mode: "update" })).toEqual({
      success: true, data: { description: "A change" },
    });
    expectIssue(validateCollectionData(posts, { title: "x" }, { mode: "update" }), ["title"]);
  });

  test("draft permits incomplete documents and still applies defaults", () => {
    expect(validateCollectionData(posts, {}, { mode: "draft" })).toEqual({
      success: true, data: { requiredDefault: "hello", featured: false },
    });
    expect(validateCollectionData(posts, { title: null, requiredDefault: null }, { mode: "draft" })).toEqual({
      success: true, data: { title: null, requiredDefault: "hello", featured: false },
    });
    expectIssue(validateCollectionData(posts, { title: "x" }, { mode: "draft" }), ["title"]);
    expectIssue(validateCollectionData(posts, { title: 12 }, { mode: "draft" }), ["title"]);
  });

  test.each(["create", "update"] as const)("%s rejects null on required fields", (mode) => {
    expectIssue(validateCollectionData(posts, { title: null }, { mode }), ["title"]);
  });

  test.each(["create", "update", "draft"] as const)("%s normalizes explicit null to defaults", (mode) => {
    expect(validateCollectionData(posts, { title: "Hello", requiredDefault: null, featured: null }, { mode })).toEqual({
      success: true, data: { title: "Hello", requiredDefault: "hello", featured: false },
    });
  });

  test.each(["create", "update", "draft"] as const)("%s rejects unknown and system-managed keys", (mode) => {
    for (const key of ["extra", "id", "slug", "status", "createdAt", "updatedAt"]) {
      const result = validateCollectionData(posts, { title: "Hello", [key]: "unexpected" }, { mode });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues.length).toBeGreaterThan(0);
        for (const issue of result.issues) {
          expect(Array.isArray(issue.path)).toBe(true);
          expect(typeof issue.message).toBe("string");
        }
      }
    }
  });

  test.each([null, [], "text", 123, true].map((input) => ({ input })))("rejects non-object input %j", ({ input }) => {
    expect(validateCollectionData(posts, input, { mode: "create" }).success).toBe(false);
  });

  test("buildCollectionSchema exposes the same validation behavior", () => {
    expect(buildCollectionSchema(posts, { mode: "create" }).parse({ title: "Hello" })).toEqual({
      title: "Hello", requiredDefault: "hello", featured: false,
    });
    expect(buildCollectionSchema(posts, { mode: "update" }).parse({})).toEqual({});
    expect(buildCollectionSchema(posts, { mode: "draft" }).parse({ title: null })).toEqual({
      title: null, requiredDefault: "hello", featured: false,
    });
    expect(buildCollectionSchema(posts, { mode: "create" }).safeParse({ title: "x" }).success).toBe(false);
  });
});

const constraints = defineCollection({
  slug: "constraints",
  fields: {
    title: text({ required: true, minLength: 2, maxLength: 5, pattern: /^[A-Z]+$/ }),
    summary: textarea({ minLength: 2, maxLength: 5, rows: 3 }),
    count: number({ min: 0, max: 10, integer: true }),
    decimal: number(),
    active: boolean(),
    category: select({ options: ["news", { label: "Guide", value: "guide" }] }),
    tags: select({ options: ["one", "two"], hasMany: true }),
    cover: media({ relationTo: "assets" }),
    gallery: media({ relationTo: "assets", hasMany: true }),
    author: relation({ relationTo: "authors" }),
    related: relation({ relationTo: "constraints", hasMany: true }),
    body: richText(),
  },
});

function validate(input: unknown, mode: Mode = "update") {
  return validateCollectionData(constraints, input, { mode });
}

describe("field constraints", () => {
  test("accepts values at inclusive length and numeric bounds", () => {
    expect(validate({ title: "AB", summary: "ab", count: 0 }).success).toBe(true);
    expect(validate({ title: "ABCDE", summary: "abcde", count: 10 }).success).toBe(true);
    expect(validate({ decimal: -1.25 }).success).toBe(true);
  });

  test.each([
    { title: "A" }, { title: "ABCDEF" }, { title: "abc" }, { title: 123 },
  ])("rejects invalid text %j", (input) => {
    expectIssue(validate(input), ["title"]);
  });

  test.each([{ summary: "a" }, { summary: "abcdef" }, { summary: 123 }])(
    "rejects invalid textarea %j", (input) => expectIssue(validate(input), ["summary"]),
  );

  test.each([-1, 11, 1.5, NaN, Infinity, -Infinity, "2"])("rejects invalid constrained number %j", (count) => {
    expectIssue(validate({ count }), ["count"]);
  });

  test.each([NaN, Infinity, -Infinity])("unconstrained numbers still reject non-finite %j", (decimal) => {
    expectIssue(validate({ decimal }), ["decimal"]);
  });

  test("boolean validation never coerces values", () => {
    expect(validate({ active: true }).success).toBe(true);
    expect(validate({ active: false }).success).toBe(true);
    for (const active of [0, 1, "true", "false"]) expectIssue(validate({ active }), ["active"]);
  });

  test("select accepts option values, including labeled options", () => {
    expect(validate({ category: "news" }).success).toBe(true);
    expect(validate({ category: "guide" }).success).toBe(true);
    expectIssue(validate({ category: "Guide" }), ["category"]);
    expectIssue(validate({ category: "other" }), ["category"]);
    expectIssue(validate({ category: ["news"] }), ["category"]);
  });

  test("hasMany select requires arrays of distinct valid values", () => {
    expect(validate({ tags: [] }).success).toBe(true);
    expect(validate({ tags: ["one", "two"] }).success).toBe(true);
    expectIssue(validate({ tags: "one" }), ["tags"]);
    expectIssue(validate({ tags: ["one", "three"] }), ["tags", 1]);
    expect(validate({ tags: ["one", "one"] }).success).toBe(false);
    expect(validate({ tags: ["one", null] }).success).toBe(false);
  });

  test.each(["cover", "author"])("%s accepts non-empty string IDs", (field) => {
    expect(validate({ [field]: "document-1" }).success).toBe(true);
    for (const invalid of ["", 5, [], {}, ["document-1"]]) {
      expectIssue(validate({ [field]: invalid }), [field]);
    }
  });

  test.each(["gallery", "related"])("%s accepts arrays of non-empty string IDs", (field) => {
    expect(validate({ [field]: [] }).success).toBe(true);
    expect(validate({ [field]: ["document-1", "document-2"] }).success).toBe(true);
    expectIssue(validate({ [field]: "document-1" }), [field]);
    expectIssue(validate({ [field]: ["document-1", ""] }), [field, 1]);
    expectIssue(validate({ [field]: ["document-1", 3] }), [field, 1]);
  });

  test.each(["create", "update", "draft"] as const)("%s accepts null on every non-required field type", (mode) => {
    const input = {
      title: "AB", summary: null, count: null, decimal: null, active: null,
      category: null, tags: null, cover: null, gallery: null, author: null, related: null, body: null,
    };
    expect(validate(input, mode)).toEqual({ success: true, data: input });
  });

  test("rich text permits a doc with optional shallow node content", () => {
    const documents: RichTextDocument[] = [
      { type: "doc" },
      { type: "doc", content: [] },
      { type: "doc", content: [{ type: "paragraph", attrs: { align: "left" }, content: [{ type: "text", text: "Hello" }] }] },
    ];
    for (const body of documents) expect(validate({ body })).toEqual({ success: true, data: { body } });
  });

  test.each([
    "text", [], { type: "paragraph" }, {}, { type: "doc", content: {} },
    { type: "doc", content: [null] }, { type: "doc", content: [{}] },
    { type: "doc", content: [{ type: 123 }] },
  ].map((body) => ({ body })))("rejects invalid rich text %j", ({ body }) => {
    expect(validate({ body }).success).toBe(false);
  });

  test("required checks and defaults apply to all helper types", () => {
    const all = defineCollection({
      slug: "required-fields",
      fields: {
        text: text({ required: true }), textarea: textarea({ required: true }),
        number: number({ required: true }), boolean: boolean({ required: true }),
        select: select({ required: true, options: ["one"] }),
        richText: richText({ required: true }), media: media({ required: true, relationTo: "assets" }),
        relation: relation({ required: true, relationTo: "posts" }),
      },
    });
    for (const key of Object.keys(all.fields)) {
      expectIssue(validateCollectionData(all, {}, { mode: "create" }), [key]);
      expectIssue(validateCollectionData(all, { [key]: null }, { mode: "update" }), [key]);
      expect(validateCollectionData(all, { [key]: null }, { mode: "draft" }).success).toBe(true);
    }
    const defaults = defineCollection({
      slug: "defaults",
      fields: {
        title: text({ defaultValue: "Hello" }), summary: textarea({ defaultValue: "Summary" }),
        count: number({ defaultValue: 0 }), active: boolean({ defaultValue: false }),
        category: select({ options: ["one", "two"], defaultValue: "one" }),
        tags: select({ options: ["one", "two"], hasMany: true, defaultValue: ["one"] }),
        body: richText({ defaultValue: { type: "doc", content: [] } }),
        cover: media({ relationTo: "assets", defaultValue: "asset-1" }),
        related: relation({ relationTo: "posts", hasMany: true, defaultValue: [] }),
      },
    });
    const expected = {
      title: "Hello", summary: "Summary", count: 0, active: false, category: "one", tags: ["one"],
      body: { type: "doc", content: [] }, cover: "asset-1", related: [],
    } satisfies InferCreateInput<typeof defaults>;
    for (const mode of ["create", "draft"] as const) {
      expect(validateCollectionData(defaults, {}, { mode })).toEqual({ success: true, data: expected });
    }
    expect(validateCollectionData(defaults, {}, { mode: "update" })).toEqual({ success: true, data: {} });
  });
});

describe("custom field validation", () => {
  test("receives the value and sibling data, and reports its message at the field path", () => {
    const seen: unknown[] = [];
    const collection = defineCollection({
      slug: "custom",
      fields: {
        title: text({ required: true }),
        confirmation: text({ validate(value, ctx) {
          seen.push({ value, data: ctx.data });
          return value === ctx.data.title || "Must match title";
        } }),
      },
    });
    expect(validateCollectionData(collection, { title: "Hello", confirmation: "Hello" }, { mode: "create" }).success).toBe(true);
    expect(seen).toContainEqual({ value: "Hello", data: { title: "Hello", confirmation: "Hello" } });
    expectIssue(validateCollectionData(collection, { title: "Hello", confirmation: "Other" }, { mode: "create" }), ["confirmation"], "Must match title");
  });

  test("runs only after the field passes built-in checks", () => {
    let calls = 0;
    const collection = defineCollection({
      slug: "custom-order",
      fields: { count: number({ integer: true, min: 0, validate() { calls++; return true; } }) },
    });
    expectIssue(validateCollectionData(collection, { count: -1 }, { mode: "update" }), ["count"]);
    expectIssue(validateCollectionData(collection, { count: "bad" }, { mode: "update" }), ["count"]);
    expect(calls).toBe(0);
    expect(validateCollectionData(collection, { count: 2 }, { mode: "update" }).success).toBe(true);
    expect(calls).toBe(1);
  });

  test("collects custom errors even when sibling built-in validation fails", () => {
    const collection = defineCollection({
      slug: "custom-siblings",
      fields: {
        count: number({ integer: true }),
        title: text({ validate: () => "Rejected by custom rule" }),
      },
    });
    const result = validateCollectionData(collection, { count: 1.5, title: "Hello" }, { mode: "update" });
    expectIssue(result, ["count"]);
    expectIssue(result, ["title"], "Rejected by custom rule");
  });
});

describe("upload input protection", () => {
  const assets = defineCollection({ slug: "assets", upload: true, fields: { alt: text({ required: true }) } });

  test.each(["create", "update", "draft"] as const)("%s rejects all system-managed upload fields", (mode) => {
    for (const key of ["filename", "mimeType", "filesize", "url", "width", "height"]) {
      const value = ["filesize", "width", "height"].includes(key) ? 100 : "metadata";
      expect(validateCollectionData(assets, { alt: "A photo", [key]: value }, { mode }).success).toBe(false);
    }
  });

  test("upload collection input accepts only user fields", () => {
    expect(validateCollectionData(assets, { alt: "A photo" }, { mode: "create" })).toEqual({
      success: true, data: { alt: "A photo" },
    });
  });
});
