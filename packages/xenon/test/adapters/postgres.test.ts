import { afterAll } from "bun:test";
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

async function reset(run: (q: ReturnType<typeof sql.raw>) => Promise<unknown>) {
  await run(sql.raw(`DROP TABLE IF EXISTS "xenon_documents", "xenon_sessions", "xenon_accounts", "xenon_verifications", "xenon_users" CASCADE`));
}

runDatabaseAdapterConformance("pglite", async () => pgliteAdapter());

runDatabaseAdapterConformance("drizzle (supplied PGlite database)", async () => {
  await reset((q) => db.execute(q));
  return drizzleAdapter({ db });
});

const url = process.env.XENON_TEST_DATABASE_URL;
if (url) {
  // Reset through a separate client: the adapter's init() is memoized, so it must see empty tables first.
  const { default: postgres } = await import("postgres");
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  afterAll(() => admin.end());
  runDatabaseAdapterConformance("postgres (server)", async () => {
    await admin.unsafe(
      `DROP TABLE IF EXISTS "xenon_documents", "xenon_sessions", "xenon_accounts", "xenon_verifications", "xenon_users" CASCADE`,
    );
    return postgresAdapter({ connectionString: url, max: 4 });
  });
}
