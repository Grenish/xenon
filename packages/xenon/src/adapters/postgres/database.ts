import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, count, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  type CreateRecordInput,
  type DatabaseAdapter,
  type DocumentRecord,
  type FindArgs,
  type PaginatedResult,
  SlugConflictError,
  type UpdateRecordInput,
  type UpdateRecordOptions,
  UpdateConflictError,
} from "../types";
import { authDDL, authDrizzleSchema } from "./auth-schema";
import { DOCUMENTS_DDL, xenonDocuments as t } from "./schema";
import { compileOrderBy, compileWhere } from "./where";

interface Connection {
  db: PgDatabase<any, any, any>;
  close: () => Promise<void>;
}

/*
 * Clients are cached on globalThis so Next.js dev HMR (which re-evaluates the config module) reuses
 * one pool per connection string and never opens the same PGlite data directory twice.
 */
const globalCache = globalThis as typeof globalThis & { __xenonPg?: Map<string, Promise<Connection>> };
const clients: Map<string, Promise<Connection>> = (globalCache.__xenonPg ??= new Map());

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
  return conn.then((c) => ({
    db: c.db,
    close: async () => {
      if (clients.get(key) === conn) clients.delete(key);
      await c.close();
    },
  }));
}

/** Walks `cause` chains (drizzle wraps driver errors) looking for a Postgres unique violation. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    if (e.code === "23505") return true;
  }
  return false;
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
  let initPromise: Promise<void> | null = null;

  const db = (): PgDatabase<any, any, any> => {
    if (!conn) throw new Error("[xenon] database adapter used before init()");
    return conn.db;
  };

  async function guard<T>(collection: string, slug: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (slug && isUniqueViolation(err)) throw new SlugConflictError(collection, slug);
      throw err;
    }
  }

  return {
    name: "postgres",
    get db() {
      return db();
    },

    init() {
      initPromise ??= (async () => {
        conn = await connect();
        for (const stmt of DOCUMENTS_DDL) await conn.db.execute(sql.raw(stmt));
      })().catch((err) => {
        initPromise = null;
        throw err;
      });
      return initPromise;
    },

    async find(args: FindArgs): Promise<PaginatedResult<DocumentRecord>> {
      const limit = Math.max(0, Math.floor(args.limit ?? 10));
      const page = Math.max(1, Math.floor(args.page ?? 1));
      const filters = [eq(t.collection, args.collection), compileWhere(args.where, args.source)];
      if (args.source === "published") filters.push(eq(t.status, "published"));
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

    async getAuthDatabase(authOptions: BetterAuthOptions) {
      for (const stmt of authDDL(authOptions)) await db().execute(sql.raw(stmt));
      return drizzleAdapter(db(), { provider: "pg", schema: authDrizzleSchema(authOptions) });
    },

    async close() {
      await conn?.close();
      conn = null;
      initPromise = null;
    },
  };
}
