import { memoryAdapter as betterAuthMemoryAdapter } from "better-auth/adapters/memory";
import { getSchema } from "better-auth/db";
import { SlugConflictError, UpdateConflictError } from "./types";
import type { DatabaseAdapter, DocumentRecord, Where, WhereOperators } from "./types";

const systemKeys = new Set(["id", "slug", "status", "createdAt", "updatedAt"]);

/** Unicode scalar order, matching PostgreSQL COLLATE "C" for UTF-8 data. */
function compareStrings(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}

function compare(left: unknown, right: unknown): number | null {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return compareStrings(left, right);
  return null;
}

function equals(left: unknown, right: unknown): boolean {
  if (left === right || left == null && right == null) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => equals(item, right[index]));
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && equals(a[key], b[key]));
}

function matchesOperators(value: unknown, operators: WhereOperators, date: boolean): boolean {
  for (const [operator, original] of Object.entries(operators)) {
    if (original === undefined) continue;
    const expected = date && original instanceof Date ? original.toISOString() : original;
    switch (operator) {
      case "equals": if (!equals(value, expected)) return false; break;
      case "not_equals": if (equals(value, expected)) return false; break;
      case "in":
      case "not_in": {
        if (!Array.isArray(expected)) return false;
        const included = expected.some((item) => equals(value, date && item instanceof Date ? item.toISOString() : item));
        if (operator === "in" ? !included : included) return false;
        break;
      }
      case "contains":
        if (Array.isArray(value)) { if (!value.some((item) => equals(item, expected))) return false; }
        else if (!(typeof value === "string" && typeof expected === "string" && value.toLowerCase().includes(expected.toLowerCase()))) return false;
        break;
      case "exists": if ((value != null) !== expected) return false; break;
      case "gt": case "gte": case "lt": case "lte": {
        const comparison = compare(value, expected);
        if (comparison === null || (operator === "gt" && comparison <= 0) ||
          (operator === "gte" && comparison < 0) || (operator === "lt" && comparison >= 0) ||
          (operator === "lte" && comparison > 0)) return false;
        break;
      }
      default: return false;
    }
  }
  return true;
}

function valueFor(record: DocumentRecord, key: string, source: "published" | "draft"): unknown {
  if (key === "createdAt" || key === "updatedAt") return record[key].toISOString();
  if (systemKeys.has(key)) return record[key as keyof DocumentRecord];
  const data = source === "draft" ? record.draftData ?? record.data : record.data;
  return Object.hasOwn(data, key) ? data[key] : undefined;
}

function matches(record: DocumentRecord, where: Where, source: "published" | "draft"): boolean {
  return Object.entries(where).every(([key, operators]) => {
    if (operators === undefined) return true;
    if (key === "and") return Array.isArray(operators) && operators.every((part) => matches(record, part, source));
    if (key === "or") return Array.isArray(operators) && operators.some((part) => matches(record, part, source));
    if (!operators || Array.isArray(operators)) return false;
    return matchesOperators(valueFor(record, key, source), operators, key === "createdAt" || key === "updatedAt");
  });
}

/** A deterministic, isolated adapter for development and interface conformance tests. */
export function memoryAdapter(): DatabaseAdapter {
  const records = new Map<string, DocumentRecord>();
  const authRows: Record<string, Record<string, unknown>[]> = Object.create(null);

  function assertUnique(collection: string, slug: string | null, id?: string) {
    if (slug !== null && [...records.values()].some((row) => row.collection === collection && row.slug === slug && row.id !== id)) {
      throw new SlugConflictError(collection, slug);
    }
  }

  return {
    name: "memory",
    async init() {},
    async find(args) {
      const { collection, source, where = {}, sort = "-createdAt", limit = 10, page = 1 } = args;
      if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(page) || page < 1) {
        throw new Error("[xenon] limit must be a nonnegative integer and page a positive integer.");
      }
      const descending = sort.startsWith("-");
      const key = descending ? sort.slice(1) : sort;
      const rows = [...records.values()].filter((row) => row.collection === collection &&
        (source === "draft" || row.status === "published") && matches(row, where, source));
      rows.sort((left, right) => {
        const a = valueFor(left, key, source);
        const b = valueFor(right, key, source);
        if (a == null && b != null) return 1;
        if (a != null && b == null) return -1;
        const comparison = compare(a, b) ?? 0;
        return (descending ? -comparison : comparison) || compareStrings(left.id, right.id);
      });
      const totalDocs = rows.length;
      const totalPages = limit === 0 ? 1 : Math.max(1, Math.ceil(totalDocs / limit));
      const docs = page > totalPages ? [] : limit === 0 ? rows : rows.slice((page - 1) * limit, page * limit);
      return { docs: structuredClone(docs), totalDocs, limit, page, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 };
    },
    async findById(collection, id) {
      const record = records.get(id);
      return record?.collection === collection ? structuredClone(record) : null;
    },
    async create(input) {
      assertUnique(input.collection, input.slug);
      const timestamp = new Date();
      const record: DocumentRecord = {
        ...structuredClone(input), id: crypto.randomUUID(), createdAt: timestamp, updatedAt: new Date(timestamp),
      };
      records.set(record.id, record);
      return structuredClone(record);
    },
    async update(collection, id, input, options) {
      const previous = records.get(id);
      if (!previous || previous.collection !== collection) return null;
      if (options?.ifUpdatedAt && previous.updatedAt.getTime() !== options.ifUpdatedAt.getTime()) {
        throw new UpdateConflictError(collection, id);
      }
      const record = structuredClone(previous);
      if (input.slug !== undefined) record.slug = input.slug;
      if (input.status !== undefined) record.status = input.status;
      if (input.data !== undefined) record.data = structuredClone(input.data);
      if (input.draftData !== undefined) record.draftData = structuredClone(input.draftData);
      assertUnique(collection, record.slug, id);
      // Strictly increasing, so updatedAt works as the record's version (see DatabaseAdapter.update).
      record.updatedAt = new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1));
      records.set(id, record);
      return structuredClone(record);
    },
    async delete(collection, id) {
      return records.get(id)?.collection === collection ? records.delete(id) : false;
    },
    async getAuthDatabase(options) {
      for (const model of Object.keys(getSchema(options))) authRows[model] ??= [];
      return betterAuthMemoryAdapter(authRows);
    },
  };
}
