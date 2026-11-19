import type { PgDatabase } from "drizzle-orm/pg-core";
import { createDatabaseAdapter } from "./database";

/** The caller owns the supplied Drizzle connection and its lifetime. */
export function drizzleAdapter({ db }: { db: PgDatabase<any, any, any> }) {
  return createDatabaseAdapter(async () => ({ db, close: async () => {} }));
}
