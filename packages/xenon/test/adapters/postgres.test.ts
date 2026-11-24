import { afterAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { postgresAdapter } from "../../src/adapters/postgres";
import { drizzleAdapter } from "../../src/adapters/postgres/drizzle";
import { pgliteAdapter } from "../../src/adapters/postgres/pglite";
import { runDatabaseAdapterConformance } from "./conformance";

/*
 * One embedded PGlite instance shared across tests (fast); each test starts from an empty table.
 * Set XENON_TEST_DATABASE_URL to additionally run the suite against a real PostgreSQL server.
 */
const client = new PGlite();
const db = drizzle(client);
afterAll(() => client.close());

const dropTables = `DROP TABLE IF EXISTS "xenon_documents", "xenon_sessions", "xenon_accounts", "xenon_verifications", "xenon_users" CASCADE`;

runDatabaseAdapterConformance("pglite", async () => pgliteAdapter());

runDatabaseAdapterConformance("drizzle (supplied PGlite database)", async () => {
  await db.execute(sql.raw(dropTables));
  return drizzleAdapter({ db });
});

const url = process.env.XENON_TEST_DATABASE_URL;
if (url) {
  // Reset through a separate client: the adapter's init() is memoized, so it must see empty tables first.
  const { default: postgres } = await import("postgres");
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  afterAll(() => admin.end());
  test("concurrent cold starts create document and auth tables on PostgreSQL", async () => {
    await admin.unsafe(dropTables);
    const options = {
      user: { modelName: "xenon_users" }, session: { modelName: "xenon_sessions" },
      account: { modelName: "xenon_accounts" }, verification: { modelName: "xenon_verifications" },
    };
    const adapters = Array.from({ length: 8 }, () => postgresAdapter({ connectionString: url, max: 8 }));
    try {
      await Promise.all(adapters.map(a => a.init()));
      await Promise.all(adapters.map(a => a.getAuthDatabase(options)));
      const tables = await admin`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE 'xenon_%'`;
      expect(tables.map(t => t.tablename)).toEqual(expect.arrayContaining([
        "xenon_accounts", "xenon_documents", "xenon_sessions", "xenon_users", "xenon_verifications",
      ]));
    } finally {
      await Promise.all(adapters.map(a => a.close?.()));
    }
  });
  runDatabaseAdapterConformance("postgres (server)", async () => {
    await admin.unsafe(dropTables);
    return postgresAdapter({ connectionString: url, max: 4 });
  });
}
