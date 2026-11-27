import { memoryAdapter as betterAuthMemoryAdapter } from "better-auth/adapters/memory";
import { getSchema } from "better-auth/db";
import { compareStrings, compareValues, matchesOperators } from "./match";
import { SlugConflictError, UniqueConflictError, UpdateConflictError } from "./types";
import type { DatabaseAdapter, DatabaseInitOptions, DocumentRecord, FieldIndexSpec, VersionRecord, Where } from "./types";

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

/** Sets or clears an optional schedule column (kept absent when `null`, like the Postgres adapter). */
function setSchedule(record: DocumentRecord, key: "publishAt" | "unpublishAt" | "deletedAt", value: Date | null | undefined) {
  if (value === undefined) return;
  if (value === null) delete record[key];
  else record[key] = new Date(value);
}

/** Published reads hide rows whose scheduled unpublish time has passed (even before cron runs). */
function inTrashScope(record: DocumentRecord, trash: "exclude" | "include" | "only"): boolean {
  if (trash === "include") return true;
  return (record.deletedAt != null) === (trash === "only");
}

function expired(record: DocumentRecord, now: Date): boolean {
  return record.unpublishAt != null && record.unpublishAt.getTime() <= now.getTime();
}

function paginate<T>(rows: T[], limit: number, page: number) {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(page) || page < 1) {
    throw new Error("[xenon] limit must be a nonnegative integer and page a positive integer.");
  }
  const totalDocs = rows.length;
  const totalPages = limit === 0 ? 1 : Math.max(1, Math.ceil(totalDocs / limit));
  const docs = page > totalPages ? [] : limit === 0 ? rows : rows.slice((page - 1) * limit, page * limit);
  return { docs: structuredClone(docs), totalDocs, limit, page, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 };
}

/** A deterministic, isolated adapter for development and interface conformance tests. */
export function memoryAdapter(): DatabaseAdapter {
  const records = new Map<string, DocumentRecord>();
  const versions = new Map<string, VersionRecord>();
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
      const { collection, source, where = {}, sort = "-createdAt", limit = 10, page = 1 } = args;
      const now = args.now ?? new Date();
      const trash = args.trash ?? "exclude";
      const descending = sort.startsWith("-");
      const key = descending ? sort.slice(1) : sort;
      const rows = [...records.values()].filter((row) => row.collection === collection && inTrashScope(row, trash) &&
        (source === "draft" || (row.status === "published" && !expired(row, now))) && matches(row, where, source));
      rows.sort((left, right) => {
        const a = valueFor(left, key, source);
        const b = valueFor(right, key, source);
        if (a == null && b != null) return 1;
        if (a != null && b == null) return -1;
        const comparison = compareValues(a, b) ?? 0;
        return (descending ? -comparison : comparison) || compareStrings(left.id, right.id);
      });
      return paginate(rows, limit, page);
    },
    async findById(collection, id) {
      const record = records.get(id);
      return record?.collection === collection ? structuredClone(record) : null;
    },
    async create(input) {
      assertUnique(input);
      const timestamp = new Date();
      const { publishAt, unpublishAt, deletedAt, ...rest } = input;
      const record: DocumentRecord = {
        ...structuredClone(rest), id: crypto.randomUUID(), createdAt: timestamp, updatedAt: new Date(timestamp),
      };
      setSchedule(record, "publishAt", publishAt);
      setSchedule(record, "unpublishAt", unpublishAt);
      setSchedule(record, "deletedAt", deletedAt);
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
      setSchedule(record, "publishAt", input.publishAt);
      setSchedule(record, "unpublishAt", input.unpublishAt);
      setSchedule(record, "deletedAt", input.deletedAt);
      assertUnique(record, id);
      // Strictly increasing, so updatedAt works as the record's version (see DatabaseAdapter.update).
      record.updatedAt = new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1));
      records.set(id, record);
      return structuredClone(record);
    },
    async delete(collection, id) {
      return records.get(id)?.collection === collection ? records.delete(id) : false;
    },
    async createVersion(input) {
      let last = 0;
      for (const v of versions.values()) {
        if (v.collection === input.collection && v.documentId === input.documentId) last = Math.max(last, v.createdAt.getTime());
      }
      const version: VersionRecord = {
        ...structuredClone(input),
        id: crypto.randomUUID(),
        // Strictly increasing per document, so versions order without ties.
        createdAt: new Date(Math.max(Date.now(), last + 1)),
      };
      versions.set(version.id, version);
      return structuredClone(version);
    },
    async findVersions({ collection, documentId, limit = 10, page = 1 }) {
      const rows = [...versions.values()]
        .filter((v) => v.collection === collection && v.documentId === documentId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return paginate(rows, limit, page);
    },
    async findVersionById(collection, id) {
      const version = versions.get(id);
      return version?.collection === collection ? structuredClone(version) : null;
    },
    async deleteVersions(collection, documentId, options) {
      const keep = Math.max(0, Math.floor(options?.keep ?? 0));
      const rows = [...versions.values()]
        .filter((v) => v.collection === collection && v.documentId === documentId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const doomed = rows.slice(keep);
      for (const v of doomed) versions.delete(v.id);
      return doomed.length;
    },
    async findDue({ now, limit }) {
      const at = now.getTime();
      const dueAt = (r: DocumentRecord) => Math.min(
        r.publishAt ? r.publishAt.getTime() : Infinity,
        r.unpublishAt && r.status === "published" ? r.unpublishAt.getTime() : Infinity,
      );
      const rows = [...records.values()]
        .filter((r) => r.deletedAt == null && dueAt(r) <= at)
        .sort((a, b) => dueAt(a) - dueAt(b) || compareStrings(a.id, b.id));
      return structuredClone(limit > 0 ? rows.slice(0, limit) : rows);
    },
    async getAuthDatabase(options) {
      for (const model of Object.keys(getSchema(options))) authRows[model] ??= [];
      return betterAuthMemoryAdapter(authRows);
    },
  };
}
