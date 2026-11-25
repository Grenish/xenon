import type { Field, FieldsMap } from "./types";
import { containerDefault } from "./validation";

function clone<T>(v: T): T {
  return typeof v === "object" && v !== null ? structuredClone(v) : v;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readValue(field: Field, value: unknown): unknown {
  if (value === undefined || value === null) {
    if (field.defaultValue !== undefined) value = clone(field.defaultValue);
    else {
      const empty = containerDefault(field);
      if (empty === undefined) return value;
      value = empty;
    }
  }
  switch (field.type) {
    case "group":
      return isRecord(value) ? withReadDefaults(field.fields, value) : value;
    case "array":
      return Array.isArray(value) ? value.map((row) => (isRecord(row) ? withReadDefaults(field.fields, row, ["id"]) : row)) : value;
    case "blocks": {
      if (!Array.isArray(value)) return value;
      const bySlug = new Map(field.blocks.map((b) => [b.slug, b] as const));
      // Items of a block type removed from the config are left out (they no longer match the schema).
      return value.flatMap((item) => {
        const block = isRecord(item) && typeof item.blockType === "string" ? bySlug.get(item.blockType) : undefined;
        return block && isRecord(item) ? [withReadDefaults(block.fields, item, ["id", "blockType"])] : [];
      });
    }
    default:
      return value;
  }
}

/**
 * The read shape of stored data: only declared fields (plus `keep` keys), with `defaultValue`s and
 * container defaults (`group` → `{}`, `array` / `blocks` → `[]`) filled in for missing or null
 * values, recursively. Never mutates `data`.
 */
export function withReadDefaults(
  fields: FieldsMap,
  data: Record<string, unknown>,
  keep: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keep) if (Object.hasOwn(data, key)) out[key] = data[key];
  for (const [key, field] of Object.entries(fields as Record<string, Field>)) {
    const value = readValue(field, Object.hasOwn(data, key) ? data[key] : undefined);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Stored data trimmed to the current schema, recursively: drops keys of removed fields (also inside
 * groups, array rows and blocks) and blocks whose type no longer exists, so documents written under
 * an older config still validate on their next update.
 */
export function pruneToFields(fields: FieldsMap, data: Record<string, unknown>, keep: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keep) if (Object.hasOwn(data, key)) out[key] = data[key];
  for (const [key, field] of Object.entries(fields as Record<string, Field>)) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    if (field.type === "group" && isRecord(value)) out[key] = pruneToFields(field.fields, value);
    else if (field.type === "array" && Array.isArray(value)) {
      out[key] = value.map((row) => (isRecord(row) ? pruneToFields(field.fields, row, ["id"]) : row));
    } else if (field.type === "blocks" && Array.isArray(value)) {
      const bySlug = new Map(field.blocks.map((b) => [b.slug, b] as const));
      out[key] = value.flatMap((item) => {
        const block = isRecord(item) && typeof item.blockType === "string" ? bySlug.get(item.blockType) : undefined;
        return block && isRecord(item) ? [pruneToFields(block.fields, item, ["id", "blockType"])] : [];
      });
    } else out[key] = value;
  }
  return out;
}

/**
 * Applies a partial update to stored data. Top-level keys and `group` fields merge (recursively), so
 * `{ seo: { noIndex: true } }` keeps `seo.title`; `null` clears a value (a group reset to its
 * defaults). `array`, `blocks` and `json` values are replaced wholesale.
 */
export function mergeUpdate(fields: FieldsMap, stored: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(patch)) {
    const field = Object.hasOwn(fields, key) ? (fields as Record<string, Field>)[key] : undefined;
    const current = out[key];
    out[key] = field?.type === "group" && isRecord(value) && isRecord(current) ? mergeUpdate(field.fields, current, value) : value;
  }
  return out;
}
