import { getSchema, type Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import type { Schema } from "@tiptap/pm/model";
import { toPlainJson } from "../shared/plain";

/** Content extensions shared by the editor and `normalizeRichText` — they define the document schema. */
export const richTextExtensions: Extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
  Image,
];

export const EMPTY_RICH_TEXT = { type: "doc", content: [{ type: "paragraph" }] } as const;

let schema: Schema | undefined;

/**
 * Returns the value exactly as the editor would report it after loading it (`editor.getJSON()`),
 * as plain JSON: default attrs filled in, canonical key order, and the trailing paragraph Tiptap
 * always keeps at the end of a document.
 *
 * Stored documents rarely match that byte-for-byte (Postgres `jsonb` reorders keys, older content
 * may lack default attrs), so dirty-tracking must compare against this form — otherwise a freshly
 * loaded document looks edited. Values the schema can't parse are returned unchanged.
 */
export function normalizeRichText(value: unknown): unknown {
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "doc") return value;
  try {
    schema ??= getSchema(richTextExtensions);
    const json = toPlainJson(schema.nodeFromJSON(value).toJSON()) as { type: string; content?: { type: string }[] };
    const content = json.content ?? [];
    if (content.at(-1)?.type !== "paragraph") content.push({ type: "paragraph" });
    return { ...json, content };
  } catch {
    return value;
  }
}
