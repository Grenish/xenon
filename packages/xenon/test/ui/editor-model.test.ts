import { describe, expect, test } from "bun:test";
import { boolean, defineCollection, number, select, text, textarea, validateCollectionData } from "../../src/index";
import { cn } from "../../src/ui/lib/utils";
import { toClientCollection } from "../../src/ui/shared/client-config";
import { documentTitle, initialData, normalizeFormData, validateFields } from "../../src/ui/form/model";
import type { AdminDoc } from "../../src/ui/shared/services";

const collection = toClientCollection(defineCollection({
  slug: "posts", admin: { useAsTitle: "title" }, fields: {
    title: text({ required: true, minLength: 2, maxLength: 10 }),
    summary: textarea({ minLength: 2, maxLength: 20 }),
    featured: boolean({ defaultValue: false }), count: number({ integer: true, min: 0, max: 10 }),
    tags: select({ options: ["news", "guide"], hasMany: true, defaultValue: ["news"] }),
    hidden: text({ required: true, admin: { hidden: true } }),
    readonly: text({ required: true, admin: { readOnly: true } }),
  },
}));

describe("document editor state and client validation", () => {
  test("new documents use defaults and clone mutable values", () => {
    const first = initialData(collection, null);
    const second = initialData(collection, null);
    expect(first).toEqual({ featured: false, tags: ["news"] });
    (first.tags as string[]).push("guide");
    expect(second.tags).toEqual(["news"]);
    expect(collection.fields.find((field) => field.name === "tags")?.defaultValue).toEqual(["news"]);
  });

  test("edit state picks declared fields, retaining values without writable system/upload metadata", () => {
    const doc: AdminDoc = { id: "doc", slug: "hello", status: "published", hasUnpublishedChanges: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", data: { title: "Hello", featured: true, tags: ["guide"], filename: "file.png", _file: { key: "private" }, removedField: "old" } };
    const data = initialData(collection, doc);
    expect(data).toEqual({ title: "Hello", featured: true, tags: ["guide"] });
    (data.tags as string[]).push("news");
    expect(doc.data.tags).toEqual(["guide"]);
  });

  test("published data requires visible editable fields; draft saves permit missing required values", () => {
    expect(validateFields(collection.fields, {}, false)).toEqual({ title: "Title is required." });
    expect(validateFields(collection.fields, {}, true)).toEqual({});
    expect(validateFields(collection.fields, { title: null }, true)).toEqual({});
    expect(validateFields(collection.fields, { title: "Hello", featured: false }, false)).toEqual({});
  });

  test("non-empty text constraints remain active in drafts", () => {
    expect(validateFields(collection.fields, { title: "A" }, true)).toHaveProperty("title");
    expect(validateFields(collection.fields, { title: "Too long a title" }, false)).toHaveProperty("title");
    expect(validateFields(collection.fields, { title: "Hi", summary: "A" }, false)).toHaveProperty("summary");
    expect(validateFields(collection.fields, { title: "Hi", summary: "A".repeat(21) }, false)).toHaveProperty("summary");
  });

  test.each([-1, 11, 1.5, NaN, Infinity])("rejects invalid numeric input %s", (count) => {
    expect(validateFields(collection.fields, { title: "Hello", count }, false)).toHaveProperty("count");
  });

  test("accepts inclusive numeric limits and optional null", () => {
    for (const count of [0, 10, null]) expect(validateFields(collection.fields, { title: "Hello", count }, false)).toEqual({});
  });

  test("editor titles use the configured title with a friendly fallback", () => {
    expect(documentTitle(collection, { title: "A post" })).toBe("A post");
    expect(documentTitle(collection, { title: " " })).toBe("Untitled post");
  });

  test("normalizeFormData turns cleared text/textarea values into null so optional constraints can be cleared", () => {
    const raw = defineCollection({
      slug: "articles",
      fields: {
        title: text({ required: true, minLength: 2 }),
        summary: textarea({ minLength: 10 }),
        code: text({ pattern: /^[A-Z]{3}$/ }),
        note: text({ defaultValue: "" }),
      },
    });
    const client = toClientCollection(raw);

    const normalized = normalizeFormData(client.fields, { title: "Hello", summary: "", code: "", note: "" });
    expect(normalized).toEqual({ title: "Hello", summary: null, code: null, note: "" });
    expect(validateCollectionData(raw, normalized, { mode: "create" }).success).toBe(true);
    expect(validateCollectionData(raw, normalizeFormData(client.fields, { title: "", summary: "", code: "" }), { mode: "draft" }).success).toBe(true);
  });

  test("client validation enforces text pattern rules while allowing cleared optional values", () => {
    const patterned = toClientCollection(defineCollection({
      slug: "codes",
      fields: {
        code: text({ pattern: /^[A-Z]{3}$/ }),
      },
    }));

    expect(validateFields(patterned.fields, { code: "abc" }, false)).toHaveProperty("code");
    expect(validateFields(patterned.fields, { code: "abc" }, true)).toHaveProperty("code");
    expect(validateFields(patterned.fields, { code: "XYZ" }, false)).toEqual({});
    expect(validateFields(patterned.fields, { code: null }, false)).toEqual({});
    expect(validateFields(patterned.fields, { code: "" }, false)).toEqual({});
  });
});

test("cn merges prefixed variants without consuming host utilities", () => {
  expect(cn("xe:px-2 xe:hover:bg-muted", "xe:px-4 xe:hover:bg-accent")).toBe("xe:px-4 xe:hover:bg-accent");
  expect(cn("px-2", "xe:px-4", false, { "xe:flex": true })).toBe("px-2 xe:px-4 xe:flex");
});
