import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { postgresAdapter } from "../../src/adapters/postgres";
import { drizzleAdapter } from "../../src/adapters/postgres/drizzle";
import { pgliteAdapter } from "../../src/adapters/postgres/pglite";
import type { FieldIndexSpec } from "../../src/adapters/types";
import { runDatabaseAdapterConformance } from "./conformance";

/*
 * One embedded PGlite instance shared across tests (fast); each test starts from an empty table.
 * Set XENON_TEST_DATABASE_URL to additionally run the suite against a real PostgreSQL server.
 */
const client = new PGlite();
const db = drizzle(client);
afterAll(() => client.close());

const dropTables = `DROP TABLE IF EXISTS "xenon_documents", "xenon_versions", "xenon_sessions", "xenon_accounts", "xenon_verifications", "xenon_users" CASCADE`;

runDatabaseAdapterConformance("pglite", async () => pgliteAdapter());

runDatabaseAdapterConformance("drizzle (supplied PGlite database)", async () => {
  await db.execute(sql.raw(dropTables));
  return drizzleAdapter({ db });
});

const SAMPLE_INDEXES: FieldIndexSpec[] = [
  { collection: "posts", path: ["sku"], type: "text", unique: true },
  { collection: "posts", path: ["priority"], type: "number", unique: false },
  { collection: "posts", path: ["seo", "noIndex"], type: "boolean", unique: false },
  { collection: "posts", path: ["seo", "canonicalId"], type: "text", unique: true },
];

describe("Postgres JSONB expression indexes (PGlite)", () => {
  test("creates partial expression and unique indexes in pg_indexes and planner uses them", async () => {
    const adapter = pgliteAdapter();
    try {
      await adapter.init({ indexes: SAMPLE_INDEXES });
      await adapter.init({ indexes: SAMPLE_INDEXES }); // idempotent

      const idxRows = await adapter.db.execute(
        sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'xenon_documents' AND (indexname LIKE 'xenon_idx_%' OR indexname LIKE 'xenon_uidx_%')`,
      );
      const names = (idxRows.rows as { indexname: string; indexdef: string }[]).map((r) => r.indexname);
      // 4 published indexes (2 unique + 2 non-unique) + 2 working-copy unique indexes = 6
      expect(names).toHaveLength(6);
      expect(names.filter((n) => n.startsWith("xenon_uidx_p_"))).toHaveLength(2);
      expect(names.filter((n) => n.startsWith("xenon_uidx_w_"))).toHaveLength(2);
      expect(names.filter((n) => n.startsWith("xenon_idx_p_"))).toHaveLength(2);

      for (let i = 0; i < 60; i++) {
        await adapter.create({
          collection: "posts",
          slug: `p-${i}`,
          status: "published",
          data: { sku: `SKU-${i}`, priority: i, seo: { noIndex: i === 7, canonicalId: `c-${i}` } },
          draftData: null,
        });
      }
      await adapter.db.execute(sql.raw(`ANALYZE "xenon_documents"`));

      // Force planner away from seqscan on tiny test tables so we verify the expression matches the index AST.
      const explain = async (query: string) => {
        const res = await adapter.db.transaction(async (tx) => {
          await tx.execute(sql.raw("SET LOCAL enable_seqscan = off"));
          return tx.execute(sql.raw(`EXPLAIN ${query}`));
        });
        return (res.rows as { "QUERY PLAN": string }[]).map((r) => r["QUERY PLAN"]).join("\n");
      };

      const planTextEq = await explain(
        `SELECT id FROM "xenon_documents" WHERE "collection" = 'posts' AND "status" = 'published' AND ((case when jsonb_typeof(("data" -> 'sku')) = 'string' then (("data" -> 'sku') #>> '{}') end) collate "C" = 'SKU-5' collate "C")`,
      );
      expect(planTextEq).toMatch(/Index (Only )?Scan.*xenon_uidx_p_posts_sku/);

      const planNumRange = await explain(
        `SELECT id FROM "xenon_documents" WHERE "collection" = 'posts' AND "status" = 'published' AND ((case when jsonb_typeof(("data" -> 'priority')) = 'number' then (("data" -> 'priority'))::numeric end) > 50)`,
      );
      expect(planNumRange).toMatch(/Index (Only )?Scan.*xenon_idx_p_posts_priority/);

      const planNestedBool = await explain(
        `SELECT id FROM "xenon_documents" WHERE "collection" = 'posts' AND "status" = 'published' AND ((case when jsonb_typeof((("data" -> 'seo') -> 'noIndex')) = 'boolean' then ((("data" -> 'seo') -> 'noIndex') #>> '{}') end) collate "C" = 'true' collate "C")`,
      );
      expect(planNestedBool).toMatch(/Index (Only )?Scan.*xenon_idx_p_posts_seo_noindex/);

      const planNestedUnique = await explain(
        `SELECT id FROM "xenon_documents" WHERE "collection" = 'posts' AND "status" = 'published' AND ((case when jsonb_typeof((("data" -> 'seo') -> 'canonicalId')) = 'string' then ((("data" -> 'seo') -> 'canonicalId') #>> '{}') end) collate "C" = 'c-3' collate "C")`,
      );
      expect(planNestedUnique).toMatch(/Index (Only )?Scan.*xenon_uidx_p_posts_seo_canonicali/);
    } finally {
      await adapter.close?.();
    }
  });
});

const url = process.env.XENON_TEST_DATABASE_URL;
if (url) {
  // Reset through a separate client: the adapter's init() is memoized, so it must see empty tables first.
  const { default: postgres } = await import("postgres");
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  afterAll(() => admin.end());
  test("concurrent cold starts create document, expression index, and auth tables on PostgreSQL", async () => {
    await admin.unsafe(dropTables);
    const options = {
      user: { modelName: "xenon_users" }, session: { modelName: "xenon_sessions" },
      account: { modelName: "xenon_accounts" }, verification: { modelName: "xenon_verifications" },
    };
    const adapters = Array.from({ length: 8 }, () => postgresAdapter({ connectionString: url, max: 8 }));
    try {
      await Promise.all(adapters.map(a => a.init({ indexes: SAMPLE_INDEXES })));
      await Promise.all(adapters.map(a => a.getAuthDatabase(options)));
      const tables = await admin`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE 'xenon_%'`;
      expect(tables.map(t => t.tablename)).toEqual(expect.arrayContaining([
        "xenon_accounts", "xenon_documents", "xenon_sessions", "xenon_users", "xenon_verifications",
      ]));
      const indexes = await admin`SELECT indexname FROM pg_indexes WHERE tablename = 'xenon_documents' AND (indexname LIKE 'xenon_idx_%' OR indexname LIKE 'xenon_uidx_%')`;
      expect(indexes).toHaveLength(6);

      // Verify real PostgreSQL planner uses expression indexes via EXPLAIN on actual expressions.
      for (let i = 0; i < 60; i++) {
        await adapters[0]!.create({
          collection: "posts",
          slug: `pg-${i}`,
          status: "published",
          data: { sku: `PG-${i}`, priority: i, seo: { noIndex: i === 7, canonicalId: `pgc-${i}` } },
          draftData: null,
        });
      }
      await admin`ANALYZE "xenon_documents"`;
      const explainPg = async (query: string) => {
        const rows = await admin.begin(async (tx) => {
          await tx.unsafe("SET LOCAL enable_seqscan = off");
          return tx.unsafe(`EXPLAIN ${query}`);
        });
        return rows.map((r: Record<string, unknown>) => String(r["QUERY PLAN"])).join("\n");
      };
      expect(
        await explainPg(
          `SELECT id FROM "xenon_documents" WHERE "collection" = 'posts' AND "status" = 'published' AND ((case when jsonb_typeof(("data" -> 'priority')) = 'number' then (("data" -> 'priority'))::numeric end) > 50)`,
        ),
      ).toMatch(/Index (Only )?Scan.*xenon_idx_p_posts_priority/);
      expect(
        await explainPg(
          `SELECT id FROM "xenon_documents" WHERE "collection" = 'posts' AND "status" = 'published' AND ((case when jsonb_typeof((("data" -> 'seo') -> 'noIndex')) = 'boolean' then ((("data" -> 'seo') -> 'noIndex') #>> '{}') end) collate "C" = 'true' collate "C")`,
        ),
      ).toMatch(/Index (Only )?Scan.*xenon_idx_p_posts_seo_noindex/);
      expect(
        await explainPg(
          `SELECT id FROM "xenon_documents" WHERE "collection" = 'posts' AND "status" = 'published' AND ((case when jsonb_typeof((("data" -> 'seo') -> 'canonicalId')) = 'string' then ((("data" -> 'seo') -> 'canonicalId') #>> '{}') end) collate "C" = 'pgc-7' collate "C")`,
        ),
      ).toMatch(/Index (Only )?Scan.*xenon_uidx_p_posts_seo_canonicali/);
      expect(
        await explainPg(
          `SELECT id FROM "xenon_documents" WHERE "collection" = 'posts' AND ((case when jsonb_typeof((coalesce("draft_data", "data") -> 'sku')) = 'string' then ((coalesce("draft_data", "data") -> 'sku') #>> '{}') end) collate "C" = 'PG-5' collate "C")`,
        ),
      ).toMatch(/Index (Only )?Scan.*xenon_uidx_w_posts_sku/);
    } finally {
      await Promise.all(adapters.map(a => a.close?.()));
    }
  });
  runDatabaseAdapterConformance("postgres (server)", async () => {
    await admin.unsafe(dropTables);
    return postgresAdapter({ connectionString: url, max: 4 });
  });
}
