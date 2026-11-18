import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { toPlainJson } from "../../src/ui/shared/plain";

/**
 * Regression: rich-text node `attrs` were lost on save. ProseMirror creates attrs with
 * `Object.create(null)`; React's Server Action encoder replaces null-prototype objects with opaque
 * references, so the server received headings without `level`, links without `href`, etc.
 */
const schema = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Image]);
interface Json { type: string; attrs?: Record<string, unknown>; content: Json[]; marks?: Json[]; text?: string }

const source = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
    { type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
    { type: "image", attrs: { src: "/api/xenon/_files/a.png", alt: "A" } },
  ],
};

function nonPlainPaths(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return [];
  const proto = Object.getPrototypeOf(value);
  const own = proto === Object.prototype || proto === Array.prototype ? [] : [path];
  return own.concat(Object.entries(value).flatMap(([key, item]) => nonPlainPaths(item, `${path}.${key}`)));
}

describe("rich text values crossing the Server Action boundary", () => {
  const editorJson = schema.nodeFromJSON(source).toJSON() as Json;

  test("precondition: the editor's JSON really contains null-prototype attrs", () => {
    expect(nonPlainPaths(editorJson)).toContain("$.content.0.attrs");
  });

  test("toPlainJson yields only plain objects and keeps every attr", () => {
    const plain = toPlainJson(editorJson);
    expect(nonPlainPaths(plain)).toEqual([]);
    expect(plain.content[0]!.attrs).toEqual({ level: 2 });
    expect(plain.content[1]!.content[0]!.marks![0]!.attrs!.href).toBe("https://example.com");
    expect(plain.content[2]!.attrs).toMatchObject({ src: "/api/xenon/_files/a.png", alt: "A" });
    expect(JSON.stringify(plain)).toBe(JSON.stringify(editorJson));
  });

  test("an action input wrapping the document is plain all the way down", () => {
    const input = toPlainJson({ type: "doc.save", collection: "posts", data: { body: editorJson, tags: ["a"], n: 1, missing: undefined }, draft: true });
    expect(nonPlainPaths(input)).toEqual([]);
    expect(Object.hasOwn(input.data, "missing")).toBe(false);
    expect((input.data.body as Json).content[0]!.attrs).toEqual({ level: 2 });
  });
});

describe("rich text dirty-tracking baseline", () => {
  test("a stored document (jsonb key order, missing default attrs) normalizes to the editor's own JSON", async () => {
    const { normalizeRichText } = await import("../../src/ui/form/rich-text-schema");
    const stored = { content: [{ content: [{ text: "Why", type: "text" }], type: "heading" }, { type: "paragraph", content: [{ text: "Body", type: "text" }] }], type: "doc" };
    const normalized = normalizeRichText(stored);
    expect(JSON.stringify(normalized)).toBe(JSON.stringify({ type: "doc", content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Why" }] },
      { type: "paragraph", content: [{ type: "text", text: "Body" }] },
    ] }));
    expect(nonPlainPaths(normalized)).toEqual([]);
    expect(JSON.stringify(normalizeRichText(normalized))).toBe(JSON.stringify(normalized));
  });

  test("keeps explicit attrs, appends the trailing paragraph the editor maintains, and passes through unknown values", async () => {
    const { normalizeRichText } = await import("../../src/ui/form/rich-text-schema");
    const doc = normalizeRichText({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "T" }] }] }) as Json;
    expect(doc.content[0]!.attrs).toEqual({ level: 2 });
    expect(doc.content.at(-1) as unknown).toEqual({ type: "paragraph" });
    expect(normalizeRichText({ type: "doc", content: [] })).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    const unknown = { type: "doc", content: [{ type: "not-a-node" }] };
    expect(normalizeRichText(unknown)).toBe(unknown);
    expect(normalizeRichText(null)).toBe(null);
  });

  test("initialData holds rich text in normalized form", async () => {
    const { defineCollection, richText, text } = await import("../../src/index");
    const { toClientCollection } = await import("../../src/ui/shared/client-config");
    const { initialData } = await import("../../src/ui/form/model");
    const collection = toClientCollection(defineCollection({ slug: "posts", fields: { title: text(), body: richText() } }));
    const doc = { id: "1", slug: null, status: "draft" as const, hasUnpublishedChanges: false, createdAt: "", updatedAt: "", data: { title: "A", body: { content: [{ content: [{ text: "H", type: "text" }], type: "heading" }], type: "doc" } } };
    expect((initialData(collection, doc).body as Json).content[0]!.attrs).toEqual({ level: 1 });
    expect(Object.hasOwn(initialData(collection, null), "body")).toBe(false);
  });
});
