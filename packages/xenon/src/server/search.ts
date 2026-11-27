import type { AnyCollection, Field, FieldsMap, RichTextDocument } from "../core/types";
import { richTextToPlainText } from "../html/rich-text";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushString(value: unknown, out: string[]): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) out.push(trimmed);
}

function collectFieldText(fields: FieldsMap, data: Record<string, unknown>, out: string[]): void {
  for (const [key, field] of Object.entries(fields as Record<string, Field>)) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    if (value === null || value === undefined) continue;

    switch (field.type) {
      case "text":
      case "textarea":
      case "email":
      case "url":
        pushString(value, out);
        break;
      case "select":
        if (Array.isArray(value)) {
          for (const item of value) pushString(item, out);
        } else {
          pushString(value, out);
        }
        break;
      case "richText":
        pushString(richTextToPlainText(value as RichTextDocument), out);
        break;
      case "group":
        if (isRecord(value)) collectFieldText(field.fields, value, out);
        break;
      case "array":
        if (Array.isArray(value)) {
          for (const row of value) {
            if (isRecord(row)) collectFieldText(field.fields, row, out);
          }
        }
        break;
      case "blocks":
        if (Array.isArray(value)) {
          const bySlug = new Map(field.blocks.map((b) => [b.slug, b] as const));
          for (const item of value) {
            if (!isRecord(item) || typeof item.blockType !== "string") continue;
            const block = bySlug.get(item.blockType);
            if (block) collectFieldText(block.fields, item, out);
          }
        }
        break;
      default:
        break;
    }
  }
}

/**
 * Extracts normalized searchable plain text from a document according to its collection schema:
 * text/textarea/email/url/select fields, `richText` via `richTextToPlainText()`, nested
 * `group`/`array`/`blocks`, document `slug` (or pending draft slug), and upload `filename`.
 */
export function searchTextFor(
  collection: Pick<AnyCollection, "fields" | "upload">,
  data: Record<string, unknown>,
  slug?: string | null,
): string {
  const parts: string[] = [];
  const pendingSlug = isRecord(data._slug) && typeof data._slug.pending === "string" ? data._slug.pending : undefined;
  pushString(pendingSlug ?? slug, parts);
  if (collection.upload) pushString(data.filename, parts);
  collectFieldText(collection.fields, data, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Search vector fields for `db.create(...)`. */
export function createSearchInput(
  collection: Pick<AnyCollection, "fields" | "upload">,
  data: Record<string, unknown>,
  slug: string | null,
  asDraft: boolean,
): { searchText: string; draftSearchText: string | null } {
  const text = searchTextFor(collection, data, slug);
  return asDraft
    ? { searchText: "", draftSearchText: text }
    : { searchText: text, draftSearchText: null };
}

/** Search vector fields for `db.update(...)`. */
export function updateSearchInput(
  collection: Pick<AnyCollection, "fields" | "upload">,
  data: Record<string, unknown>,
  slug: string | null,
  asDraft: boolean,
): { searchText?: string; draftSearchText: string | null } {
  const text = searchTextFor(collection, data, slug);
  return asDraft
    ? { draftSearchText: text }
    : { searchText: text, draftSearchText: null };
}
