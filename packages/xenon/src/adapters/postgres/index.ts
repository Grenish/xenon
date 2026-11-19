import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { cached, createDatabaseAdapter } from "./database";

export { xenonDocuments } from "./schema";

export interface PostgresAdapterOptions {
  connectionString: string;
  max?: number;
}

export function postgresAdapter({ connectionString, max = 10 }: PostgresAdapterOptions) {
  return createDatabaseAdapter(() => cached(`pg:${connectionString}`, async () => {
    const client = postgres(connectionString, { max, onnotice: () => {} });
    return { db: drizzle(client), close: () => client.end() };
  }));
}
