/**
 * Admin list filters (#18): what a filter can be, how it travels in the URL (`?filter=` JSON), and
 * how it becomes a `where`. Isomorphic: the list view builds filters, the admin loader applies them.
 */
import type { Where } from "../../adapters/types";
import type { ClientField } from "./client-config";

export type FilterOp = "contains" | "equals" | "not_equals" | "gt" | "lt" | "exists" | "not_exists";

export interface ListFilter {
  field: string;
  op: FilterOp;
  /** Absent for `exists` / `not_exists`. */
  value?: string | number | boolean;
}

export const MAX_LIST_FILTERS = 10;

export const FILTER_OP_LABEL: Record<FilterOp, string> = {
  contains: "contains",
  equals: "is",
  not_equals: "is not",
  gt: "is after",
  lt: "is before",
  exists: "is set",
  not_exists: "is empty",
};

/** Operators offered for a field, or `[]` when it can't be filtered from the list. */
export function filterOps(field: ClientField): FilterOp[] {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "url":
      return ["contains", "equals", "not_equals", "exists", "not_exists"];
    case "select":
      return field.hasMany ? ["contains", "exists", "not_exists"] : ["equals", "not_equals", "exists", "not_exists"];
    case "number":
      return ["equals", "not_equals", "gt", "lt", "exists", "not_exists"];
    case "boolean":
      return ["equals"];
    case "date":
      return ["gt", "lt", "exists", "not_exists"];
    case "relation":
    case "media":
      return ["exists", "not_exists"];
    default:
      return [];
  }
}

export function filterableFields(fields: readonly ClientField[]): ClientField[] {
  return fields.filter((f) => !f.admin.hidden && filterOps(f).length > 0);
}

/** Normalizes one filter against `fields`, or `null` when it doesn't fit (unknown field, bad value). */
function normalize(raw: unknown, fields: readonly ClientField[]): ListFilter | null {
  if (!raw || typeof raw !== "object") return null;
  const { field: name, op, value } = raw as Record<string, unknown>;
  const field = fields.find((f) => f.name === name && !f.admin.hidden);
  if (!field || typeof op !== "string" || !filterOps(field).includes(op as FilterOp)) return null;
  const filter = { field: field.name, op: op as FilterOp };
  if (op === "exists" || op === "not_exists") return filter;
  switch (field.type) {
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
      return Number.isFinite(n) ? { ...filter, value: n } : null;
    }
    case "boolean":
      return value === true || value === "true" ? { ...filter, value: true } : value === false || value === "false" ? { ...filter, value: false } : null;
    case "date": {
      const date = typeof value === "string" ? new Date(value) : null;
      return date && !Number.isNaN(date.getTime()) ? { ...filter, value: date.toISOString() } : null;
    }
    case "select":
      return typeof value === "string" && (field.options ?? []).some((o) => o.value === value) ? { ...filter, value } : null;
    default:
      return typeof value === "string" && value.length > 0 && value.length <= 200 ? { ...filter, value } : null;
  }
}

/** Reads `?filter=` (a JSON array), keeping only valid filters. Never throws. */
export function parseListFilters(raw: string | null | undefined, fields: readonly ClientField[]): ListFilter[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ListFilter[] = [];
  for (const item of parsed.slice(0, MAX_LIST_FILTERS)) {
    const filter = normalize(item, fields);
    if (filter) out.push(filter);
  }
  return out;
}

export function serializeListFilters(filters: readonly ListFilter[]): string | null {
  return filters.length ? JSON.stringify(filters) : null;
}

/** One `where` clause per filter (combined with AND by the caller). */
export function listFiltersToWhere(filters: readonly ListFilter[]): Where[] {
  return filters.map(({ field, op, value }) => {
    if (op === "exists") return { [field]: { exists: true } };
    if (op === "not_exists") return { [field]: { exists: false } };
    return { [field]: { [op]: value } };
  });
}
