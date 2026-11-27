import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, count, eq, gte, or, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  type CollectionSummary,
  type CreateRecordInput,
  type DatabaseAdapter,
  type DatabaseInitOptions,
  type DocumentRecord,
  type FieldIndexSpec,
  type FieldIndexType,
  type FindArgs,
  type PaginatedResult,
  SlugConflictError,
  type SummarizeArgs,
  type UpdateRecordInput,
  type UpdateRecordOptions,
  UniqueConflictError,
  UpdateConflictError,
} from "../types";
import { authDDL, authDrizzleSchema } from "./auth-schema";
import { DOCUMENTS_DDL, xenonDocuments as t } from "./schema";
import { compileOrderBy, compileWhere, pgStringLiteral } from "./where";

interface Connection {
  db: PgDatabase<any, any, any>;
  close: () => Promise<void>;
}

/*
 * Clients are cached on globalThis so Next.js dev HMR (which re-evaluates the config module) reuses
 * one pool per connection string and never opens the same PGlite data directory twice.
 */
const globalCache = globalThis as typeof globalThis & {
  __xenonPg?: Map<string, Promise<Connection>>;
  __xenonPgLeases?: WeakMap<Connection, number>;
};
const clients: Map<string, Promise<Connection>> = (globalCache.__xenonPg ??= new Map());
const leases = (globalCache.__xenonPgLeases ??= new WeakMap<Connection, number>());

export function cached(key: string | null, open: () => Promise<Connection>): Promise<Connection> {
  if (key === null) return open();
  let conn = clients.get(key);
  if (!conn) {
    conn = open().catch((err) => {
      clients.delete(key);
      throw err;
    });
    clients.set(key, conn);
  }
  return conn.then((c) => {
    leases.set(c, (leases.get(c) ?? 0) + 1);
    let released = false;
    return {
      db: c.db,
      close: async () => {
        if (released) return;
        released = true;
        const remaining = leases.get(c)! - 1;
        leases.set(c, remaining);
        if (remaining > 0) return;
        if (clients.get(key) === conn) clients.delete(key);
        await c.close();
      },
    };
  });
}

// One server-side statement keeps the advisory lock through every DDL command,
// including on supplied Drizzle drivers without interactive transactions.
async function initializeSchema(db: Connection["db"], statements: readonly string[]) {
  const body = `BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('xenon-cms'), hashtext('schema-init'));
    ${statements.join(";\n")};
  END`;
  // BetterAuth identifiers can contain dollar-quote delimiters.
  let tag = "xenon_ddl";
  while (body.includes(`$${tag}$`)) tag += "_";
  await db.execute(sql.raw(`DO $${tag}$${body}$${tag}$`));
}

/** Dual-32-bit FNV-1a hash (16 hex chars) for deterministic <=63-byte Postgres index names. */
function shortHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

function sanitizeIdentPart(input: string, maxLen: number): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, maxLen) || "f";
}

function fieldIndexName(spec: FieldIndexSpec, scope: "p" | "w"): string {
  const prefix = spec.unique ? `xenon_uidx_${scope}` : `xenon_idx_${scope}`;
  const coll = sanitizeIdentPart(spec.collection, 14);
  const path = sanitizeIdentPart(spec.path.join("_"), 14);
  const hash = shortHash(`${scope}:${spec.unique ? "u" : "i"}:${spec.type}:${spec.collection}:${spec.path.join(".")}`);
  return `${prefix}_${coll}_${path}_${hash}`.slice(0, 63);
}

function rawJsonPathExpr(sourceSql: string, path: readonly string[]): string {
  let expr = sourceSql;
  for (const seg of path) expr = `(${expr} -> ${pgStringLiteral(seg)})`;
  return expr;
}

function rawTypedExpr(pathSql: string, type: FieldIndexType): { expr: string; column: string } {
  if (type === "number") {
    const expr = `(case when jsonb_typeof(${pathSql}) = 'number' then (${pathSql})::numeric end)`;
    return { expr, column: expr };
  }
  if (type === "boolean") {
    const expr = `(case when jsonb_typeof(${pathSql}) = 'boolean' then (${pathSql} #>> '{}') end)`;
    return { expr, column: `${expr} COLLATE "C"` };
  }
  const expr = `(case when jsonb_typeof(${pathSql}) = 'string' then (${pathSql} #>> '{}') end)`;
  return { expr, column: `${expr} COLLATE "C"` };
}

interface GeneratedIndex {
  name: string;
  ddl: string;
  spec: FieldIndexSpec;
}

function buildFieldIndexDdl(spec: FieldIndexSpec): GeneratedIndex[] {
  const collLit = pgStringLiteral(spec.collection);
  const out: GeneratedIndex[] = [];
  // Published expression index: accelerates published equality/range/sort queries, and when `unique`,
  // enforces uniqueness across live published rows (`status = 'published'`).
  const pubName = fieldIndexName(spec, "p");
  const pubTyped = rawTypedExpr(rawJsonPathExpr(`"data"`, spec.path), spec.type);
  const pubWhere = spec.unique
    ? `"collection" = ${collLit} AND "status" = 'published' AND ${pubTyped.expr} IS NOT NULL`
    : `"collection" = ${collLit} AND "status" = 'published'`;
  out.push({
    name: pubName,
    ddl: `CREATE ${spec.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS "${pubName}" ON "xenon_documents" (${pubTyped.column}) WHERE ${pubWhere}`,
    spec,
  });

  if (spec.unique) {
    // Working-copy partial unique index: enforces uniqueness across all working copies (drafts +
    // published rows), preventing two drafts or a draft and published doc from colliding.
    const workName = fieldIndexName(spec, "w");
    const workTyped = rawTypedExpr(rawJsonPathExpr(`coalesce("draft_data", "data")`, spec.path), spec.type);
    out.push({
      name: workName,
      ddl: `CREATE UNIQUE INDEX IF NOT EXISTS "${workName}" ON "xenon_documents" (${workTyped.column}) WHERE "collection" = ${collLit} AND ${workTyped.expr} IS NOT NULL`,
      spec,
    });
  }
  return out;
}

/** Walks `cause` chains (drizzle wraps driver errors) looking for a Postgres unique violation (23505). */
function extractUniqueViolation(err: unknown): { constraint?: string; detail?: string; message?: string } | null {
  for (
    let e = err as { code?: unknown; constraint?: unknown; constraint_name?: unknown; detail?: unknown; message?: unknown; cause?: unknown } | undefined,
      i = 0;
    e && i < 6;
    e = e.cause as typeof e, i++
  ) {
    if (e.code === "23505") {
      const constraint = typeof e.constraint === "string"
        ? e.constraint
        : typeof e.constraint_name === "string"
          ? e.constraint_name
          : undefined;
      return {
        constraint,
        detail: typeof e.detail === "string" ? e.detail : undefined,
        message: typeof e.message === "string" ? e.message : undefined,
      };
    }
  }
  return null;
}

type Row = typeof t.$inferSelect;

function toRecord(row: Row): DocumentRecord {
  return {
    id: row.id,
    collection: row.collection,
    slug: row.slug,
    status: row.status,
    data: structuredClone(row.data ?? {}),
    draftData: row.draftData ? structuredClone(row.draftData) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

/**
 * Drizzle-based PostgreSQL adapter. Stores every collection in the polymorphic `xenon_documents`
 * table and BetterAuth data in `xenon_users` / `xenon_sessions` / `xenon_accounts` / `xenon_verifications`.
 */
export function createDatabaseAdapter(connect: () => Promise<Connection>): DatabaseAdapter & {
  /** The underlying Drizzle database (available after `init()`). */
  readonly db: PgDatabase<any, any, any>;
} {
  let conn: Connection | null = null;
  let baseInitPromise: Promise<void> | null = null;
  const appliedIndexNames = new Set<string>();
  const uniqueIndexByName = new Map<string, FieldIndexSpec>();
  const publishedIndexesByCollection = new Map<string, Map<string, FieldIndexType>>();
  const workingIndexesByCollection = new Map<string, Map<string, FieldIndexType>>();

  const db = (): PgDatabase<any, any, any> => {
    if (!conn) throw new Error("[xenon] database adapter used before init()");
    return conn.db;
  };

  async function guard<T>(collection: string, slug: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const violation = extractUniqueViolation(err);
      if (violation) {
        if (violation.constraint) {
          const uniqueSpec = uniqueIndexByName.get(violation.constraint);
          if (uniqueSpec) throw new UniqueConflictError(uniqueSpec.collection, uniqueSpec.path);
          if (violation.constraint === "xenon_documents_collection_slug_idx") {
            throw new SlugConflictError(collection, slug ?? "");
          }
        }
        // Fallback if a driver omits `constraint` and embeds the index name in the error message.
        if (violation.message) {
          for (const [name, spec] of uniqueIndexByName) {
            if (violation.message.includes(name)) throw new UniqueConflictError(spec.collection, spec.path);
          }
        }
        if (slug) throw new SlugConflictError(collection, slug);
      }
      throw err;
    }
  }

  return {
    name: "postgres",
    get db() {
      return db();
    },

    async init(options?: DatabaseInitOptions) {
      baseInitPromise ??= (async () => {
        conn ??= await connect();
        await initializeSchema(conn.db, DOCUMENTS_DDL);
      })().catch((err) => {
        baseInitPromise = null;
        throw err;
      });
      await baseInitPromise;

      const specs = options?.indexes;
      if (!specs?.length) return;
      const pending: GeneratedIndex[] = [];
      for (const spec of specs) {
        if (!spec.path.length) continue;
        const normalized: FieldIndexSpec = { ...spec, path: [...spec.path] };
        let pubByPath = publishedIndexesByCollection.get(normalized.collection);
        if (!pubByPath) {
          pubByPath = new Map();
          publishedIndexesByCollection.set(normalized.collection, pubByPath);
        }
        pubByPath.set(normalized.path.join("."), normalized.type);
        if (normalized.unique) {
          let workByPath = workingIndexesByCollection.get(normalized.collection);
          if (!workByPath) {
            workByPath = new Map();
            workingIndexesByCollection.set(normalized.collection, workByPath);
          }
          workByPath.set(normalized.path.join("."), normalized.type);
        }
        for (const gen of buildFieldIndexDdl(normalized)) {
          if (normalized.unique) uniqueIndexByName.set(gen.name, normalized);
          if (!appliedIndexNames.has(gen.name)) pending.push(gen);
        }
      }
      if (pending.length) {
        await initializeSchema(db(), pending.map((g) => g.ddl));
        for (const gen of pending) appliedIndexNames.add(gen.name);
      }
    },

    async find(args: FindArgs): Promise<PaginatedResult<DocumentRecord>> {
      const limit = Math.max(0, Math.floor(args.limit ?? 10));
      const page = Math.max(1, Math.floor(args.page ?? 1));
      const indexedFields =
        args.source === "published"
          ? publishedIndexesByCollection.get(args.collection)
          : workingIndexesByCollection.get(args.collection);
      // Schema-registered collections inline the literal collection name so PostgreSQL's planner
      // proves partial-index predicates (`WHERE "collection" = '...'`) even on generic prepared plans.
      const collectionFilter = indexedFields
        ? sql`${t.collection} = ${sql.raw(pgStringLiteral(args.collection))}`
        : eq(t.collection, args.collection);
      const filters = [
        collectionFilter,
        compileWhere(args.where, args.source, indexedFields),
      ];
      if (args.source === "published") filters.push(sql`${t.status} = 'published'`);
      const condition = and(...filters);

      const [{ total } = { total: 0 }] = await db().select({ total: count() }).from(t).where(condition);
      let query = db().select().from(t).where(condition).orderBy(compileOrderBy(args.sort, args.source)).$dynamic();
      if (limit > 0) query = query.limit(limit).offset((page - 1) * limit);
      // limit 0 = everything on page 1; any later page is out of range.
      const rows = limit === 0 && page > 1 ? [] : ((await query) as Row[]);

      const totalDocs = Number(total);
      const totalPages = limit === 0 ? 1 : Math.max(1, Math.ceil(totalDocs / limit));
      return {
        docs: rows.map(toRecord),
        totalDocs,
        limit,
        page,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    },

    async findById(collection, id) {
      const [row] = await db()
        .select()
        .from(t)
        .where(and(eq(t.collection, collection), eq(t.id, id)))
        .limit(1);
      return row ? toRecord(row as Row) : null;
    },

    async create(input: CreateRecordInput) {
      const now = new Date();
      return guard(input.collection, input.slug, async () => {
        const [row] = await db()
          .insert(t)
          .values({
            id: crypto.randomUUID(),
            collection: input.collection,
            slug: input.slug,
            status: input.status,
            data: input.data,
            draftData: input.draftData,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return toRecord(row as Row);
      });
    },

    async update(collection, id, input: UpdateRecordInput, options?: UpdateRecordOptions) {
      return guard(collection, input.slug, async () => {
        const set: Partial<typeof t.$inferInsert> = {};
        if (input.slug !== undefined) set.slug = input.slug;
        if (input.status !== undefined) set.status = input.status;
        if (input.data !== undefined) set.data = input.data;
        if (input.draftData !== undefined) set.draftData = input.draftData;
        const now = new Date().toISOString();
        const match = and(eq(t.collection, collection), eq(t.id, id));
        const [row] = await db()
          .update(t)
          // Strictly increasing (never backwards on clock skew, never equal on same-millisecond saves),
          // so updatedAt is a reliable version for optimistic concurrency.
          .set({ ...set, updatedAt: sql`greatest(${t.updatedAt} + interval '1 millisecond', ${now}::timestamptz)` as unknown as Date })
          // Compared at millisecond precision: that's what JS Dates (and so clients) carry.
          .where(options?.ifUpdatedAt ? and(match, sql`date_trunc('milliseconds', ${t.updatedAt}) = ${options.ifUpdatedAt.toISOString()}::timestamptz`) : match)
          .returning();
        if (row) return toRecord(row as Row);
        // Only on the failure path: tell "not found" apart from "changed by someone else".
        if (options?.ifUpdatedAt) {
          const [exists] = await db().select({ id: t.id }).from(t).where(match).limit(1);
          if (exists) throw new UpdateConflictError(collection, id);
        }
        return null;
      });
    },

    async delete(collection, id) {
      const rows = await db()
        .delete(t)
        .where(and(eq(t.collection, collection), eq(t.id, id)))
        .returning({ id: t.id });
      return rows.length > 0;
    },

    async summarize(args: SummarizeArgs): Promise<CollectionSummary> {
      // Aggregates in SQL; only a handful of rows (recent / attention / images) carry document bodies.
      const inCollection = eq(t.collection, args.collection);
      const working = sql`coalesce(${t.draftData}, ${t.data})`;
      const attention = sql`(${t.status} <> 'published' or ${t.draftData} is not null)`;
      const newest = sql`${t.updatedAt} desc, ${t.id} collate "C" asc`;
      const since = args.since;
      const [totals, activity, recent, oldest, images] = await Promise.all([
        db().select({
          total: count(),
          published: sql<number>`count(*) filter (where ${t.status} = 'published')`,
          drafts: sql<number>`count(*) filter (where ${t.status} <> 'published')`,
          changed: sql<number>`count(*) filter (where ${t.status} = 'published' and ${t.draftData} is not null)`,
          attention: sql<number>`count(*) filter (where ${attention})`,
          bytes: sql<string | number | null>`sum(case when jsonb_typeof(${working} -> 'filesize') = 'number' then (${working} ->> 'filesize')::numeric end)`,
        }).from(t).where(inCollection),
        db().select({ createdAt: t.createdAt, updatedAt: t.updatedAt }).from(t)
          .where(and(inCollection, or(gte(t.updatedAt, since), gte(t.createdAt, since)))),
        args.recent > 0 ? db().select().from(t).where(inCollection).orderBy(newest).limit(args.recent) : [],
        args.attention > 0
          ? db().select().from(t).where(and(inCollection, attention)).orderBy(sql`${t.updatedAt} asc, ${t.id} collate "C" asc`).limit(args.attention)
          : [],
        args.images > 0
          ? db().select().from(t).where(and(inCollection, sql`(${working} ->> 'mimeType') like 'image/%'`)).orderBy(newest).limit(args.images)
          : [],
      ]);
      const row = totals[0];
      const edited: Date[] = [];
      const created: Date[] = [];
      for (const r of activity) {
        const updatedAt = new Date(r.updatedAt);
        const createdAt = new Date(r.createdAt);
        if (updatedAt >= since) edited.push(updatedAt);
        if (createdAt >= since) created.push(createdAt);
      }
      return {
        total: Number(row?.total ?? 0),
        published: Number(row?.published ?? 0),
        drafts: Number(row?.drafts ?? 0),
        changed: Number(row?.changed ?? 0),
        bytes: Number(row?.bytes ?? 0),
        edited,
        created,
        recent: (recent as Row[]).map(toRecord),
        attention: (oldest as Row[]).map(toRecord),
        attentionTotal: Number(row?.attention ?? 0),
        images: (images as Row[]).map(toRecord),
      };
    },

    async getAuthDatabase(authOptions: BetterAuthOptions) {
      await initializeSchema(db(), authDDL(authOptions));
      return drizzleAdapter(db(), { provider: "pg", schema: authDrizzleSchema(authOptions) });
    },

    async close() {
      await conn?.close();
      conn = null;
      baseInitPromise = null;
      appliedIndexNames.clear();
    },
  };
}
