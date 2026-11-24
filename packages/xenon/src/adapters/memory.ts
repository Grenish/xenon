import { memoryAdapter as betterAuthMemoryAdapter } from "better-auth/adapters/memory";
import { getSchema } from "better-auth/db";
import { compareStrings, compareValues, matchesOperators } from "./match";
import { SlugConflictError, UpdateConflictError } from "./types";
import type { DatabaseAdapter, DocumentRecord, Where } from "./types";

const systemKeys = new Set(["id", "slug", "status", "createdAt", "updatedAt"]);

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
        const comparison = compareValues(a, b) ?? 0;
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
