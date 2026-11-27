import { memoryAdapter as betterAuthMemoryAdapter } from "better-auth/adapters/memory";
import { getSchema } from "better-auth/db";
import { compareStrings, compareValues, matchesOperators } from "./match";
import { fallbackSearchText, scoreMemorySearch } from "./search";
import { SlugConflictError, UniqueConflictError, UpdateConflictError } from "./types";
import type { DatabaseAdapter, DatabaseInitOptions, DocumentRecord, FieldIndexSpec, Where } from "./types";

const systemKeys = new Set(["id", "slug", "status", "createdAt", "updatedAt"]);

function getPathValue(data: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = data;
  for (const segment of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function valueFor(record: DocumentRecord, key: string, source: "published" | "draft"): unknown {
  if (key === "createdAt" || key === "updatedAt") return record[key].toISOString();
  if (systemKeys.has(key)) return record[key as keyof DocumentRecord];
  const data = source === "draft" ? record.draftData ?? record.data : record.data;
  if (!key.includes(".")) return Object.hasOwn(data, key) ? data[key] : undefined;
  const parts = key.split(".");
  if (parts.some((p) => !p)) return undefined;
  return getPathValue(data, parts);
}

function uniqueFieldValue(data: Record<string, unknown>, spec: FieldIndexSpec): string | number | boolean | null {
  const raw = getPathValue(data, spec.path);
  if (spec.type === "text") return typeof raw === "string" ? raw : null;
  if (spec.type === "number") return typeof raw === "number" && Number.isFinite(raw) ? (Object.is(raw, -0) ? 0 : raw) : null;
  if (spec.type === "boolean") return typeof raw === "boolean" ? raw : null;
  return null;
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
  const searchIndex = new Map<string, { live: string; draft: string | null }>();
  const authRows: Record<string, Record<string, unknown>[]> = Object.create(null);
  const uniqueSpecs = new Map<string, FieldIndexSpec>();

  function assertUnique(
    candidate: Pick<DocumentRecord, "collection" | "slug" | "status" | "data" | "draftData">,
    id?: string,
  ) {
    if (candidate.slug !== null && [...records.values()].some((row) => row.collection === candidate.collection && row.slug === candidate.slug && row.id !== id)) {
      throw new SlugConflictError(candidate.collection, candidate.slug);
    }
    const candidateWorking = candidate.draftData ?? candidate.data;
    for (const spec of uniqueSpecs.values()) {
      if (spec.collection !== candidate.collection) continue;
      const workingVal = uniqueFieldValue(candidateWorking, spec);
      const liveVal = candidate.status === "published" ? uniqueFieldValue(candidate.data, spec) : null;
      if (workingVal === null && liveVal === null) continue;
      for (const row of records.values()) {
        if (row.collection !== candidate.collection || row.id === id) continue;
        if (workingVal !== null) {
          const otherWorking = uniqueFieldValue(row.draftData ?? row.data, spec);
          if (otherWorking === workingVal) throw new UniqueConflictError(spec.collection, spec.path);
        }
        if (liveVal !== null && row.status === "published") {
          const otherLive = uniqueFieldValue(row.data, spec);
          if (otherLive === liveVal) throw new UniqueConflictError(spec.collection, spec.path);
        }
      }
    }
  }

  return {
    name: "memory",
    async init(options?: DatabaseInitOptions) {
      for (const spec of options?.indexes ?? []) {
        if (!spec.unique) continue;
        const key = `${spec.collection}\0${spec.path.join(".")}`;
        uniqueSpecs.set(key, { ...spec, path: [...spec.path] });
      }
    },
    async find(args) {
      const { collection, source, where = {}, search, sort, limit = 10, page = 1 } = args;
      if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(page) || page < 1) {
        throw new Error("[xenon] limit must be a nonnegative integer and page a positive integer.");
      }
      const query = search?.trim() ?? "";
      const scores = query ? new Map<string, number>() : null;
      const rows = [...records.values()].filter((row) => {
        if (row.collection !== collection || (source !== "draft" && row.status !== "published")) return false;
        if (!matches(row, where, source)) return false;
        if (!query) return true;
        const entry = searchIndex.get(row.id);
        const text = source === "draft" ? (entry?.draft ?? entry?.live ?? "") : (entry?.live ?? "");
        const score = scoreMemorySearch(text, query);
        if (score <= 0) return false;
        scores!.set(row.id, score);
        return true;
      });
      if (scores && !sort?.trim()) {
        rows.sort((left, right) => {
          const scoreDiff = (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0);
          if (scoreDiff !== 0) return scoreDiff;
          const dateDiff = right.createdAt.getTime() - left.createdAt.getTime();
          return dateDiff || compareStrings(left.id, right.id);
        });
      } else {
        const effectiveSort = sort?.trim() || "-createdAt";
        const descending = effectiveSort.startsWith("-");
        const key = descending ? effectiveSort.slice(1) : effectiveSort;
        rows.sort((left, right) => {
          const a = valueFor(left, key, source);
          const b = valueFor(right, key, source);
          if (a == null && b != null) return 1;
          if (a != null && b == null) return -1;
          const comparison = compareValues(a, b) ?? 0;
          return (descending ? -comparison : comparison) || compareStrings(left.id, right.id);
        });
      }
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
      assertUnique(input);
      const timestamp = new Date();
      const record: DocumentRecord = {
        id: crypto.randomUUID(),
        collection: input.collection,
        slug: input.slug,
        status: input.status,
        data: structuredClone(input.data),
        draftData: structuredClone(input.draftData),
        createdAt: timestamp,
        updatedAt: new Date(timestamp),
      };
      records.set(record.id, record);
      searchIndex.set(record.id, {
        live: input.searchText !== undefined ? (input.searchText ?? "") : fallbackSearchText(record.slug, record.data),
        draft: input.draftSearchText !== undefined
          ? input.draftSearchText
          : record.draftData !== null
            ? fallbackSearchText(record.slug, record.draftData)
            : null,
      });
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
      assertUnique(record, id);
      // Strictly increasing, so updatedAt works as the record's version (see DatabaseAdapter.update).
      record.updatedAt = new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1));
      records.set(id, record);
      const prevSearch = searchIndex.get(id) ?? { live: "", draft: null };
      const live = input.searchText !== undefined
        ? (input.searchText ?? "")
        : input.data !== undefined
          ? fallbackSearchText(record.slug, record.data)
          : prevSearch.live;
      const draft = input.draftSearchText !== undefined
        ? input.draftSearchText
        : input.draftData !== undefined
          ? (record.draftData !== null ? fallbackSearchText(record.slug, record.draftData) : null)
          : prevSearch.draft;
      searchIndex.set(id, { live, draft });
      return structuredClone(record);
    },
    async delete(collection, id) {
      if (records.get(id)?.collection !== collection) return false;
      searchIndex.delete(id);
      return records.delete(id);
    },
    async getAuthDatabase(options) {
      for (const model of Object.keys(getSchema(options))) authRows[model] ??= [];
      return betterAuthMemoryAdapter(authRows);
    },
  };
}
