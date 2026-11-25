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
      return value.map((item) => {
        const block = isRecord(item) && typeof item.blockType === "string" ? bySlug.get(item.blockType) : undefined;
        return block && isRecord(item) ? withReadDefaults(block.fields, item, ["id", "blockType"]) : item;
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
