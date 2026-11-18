import type { BetterAuthOptions } from "better-auth";
import { getSchema } from "better-auth/db";
import {
  type PgColumnBuilderBase,
  boolean,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/*
 * BetterAuth tables are derived from BetterAuth's own schema description (`getSchema`), so plugins
 * (e.g. admin → role/banned/impersonatedBy) are picked up automatically. From the same description
 * we emit idempotent DDL and Drizzle table objects for BetterAuth's drizzle adapter.
 */

type AuthField = {
  type: string | readonly string[];
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  fieldName?: string;
  references?: { model: string; field: string; onDelete?: string };
};

type AuthTables = ReturnType<typeof getSchema>;

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

function sqlType(type: AuthField["type"]): string {
  if (Array.isArray(type)) return "jsonb"; // enum-like literal unions are stored as text below
  switch (type) {
    case "string":
      return "text";
    case "number":
      return "double precision";
    case "boolean":
      return "boolean";
    case "date":
      return "timestamptz";
    case "json":
    case "string[]":
    case "number[]":
      return "jsonb";
    default:
      return "text";
  }
}

function normalizedType(field: AuthField): string {
  // BetterAuth uses literal arrays (e.g. ["user", "admin"]) for enum-ish strings.
  return Array.isArray(field.type) ? "string" : (field.type as string);
}

function sortedTables(schema: AuthTables) {
  return Object.entries(schema).sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
}

/** Idempotent DDL for all BetterAuth tables, including additive columns for upgraded BetterAuth versions. */
export function authDDL(options: BetterAuthOptions): string[] {
  const statements: string[] = [];
  const schema = getSchema(options);
  for (const [model, table] of sortedTables(schema)) {
    const cols: string[] = [`${q("id")} text PRIMARY KEY`];
    const extra: string[] = [];
    for (const [key, raw] of Object.entries(table.fields)) {
      const field = raw as AuthField;
      const name = field.fieldName ?? key;
      const type = sqlType(normalizedType(field));
      let def = `${q(name)} ${type}`;
      if (field.required) def += " NOT NULL";
      if (field.unique) def += " UNIQUE";
      if (field.references) {
        def += ` REFERENCES ${q(field.references.model)}(${q(field.references.field)})`;
        if (field.references.onDelete) def += ` ON DELETE ${field.references.onDelete.toUpperCase()}`;
      }
      cols.push(def);
      // Columns added by newer BetterAuth versions/plugins: nullable so existing rows stay valid.
      extra.push(`ALTER TABLE ${q(model)} ADD COLUMN IF NOT EXISTS ${q(name)} ${type}`);
      if (field.index || field.references) {
        extra.push(`CREATE INDEX IF NOT EXISTS ${q(`${model}_${name}_idx`)} ON ${q(model)} (${q(name)})`);
      }
    }
    statements.push(`CREATE TABLE IF NOT EXISTS ${q(model)} (\n  ${cols.join(",\n  ")}\n)`, ...extra);
  }
  return statements;
}

/** Drizzle table objects keyed by model name, as expected by `drizzleAdapter(db, { schema })`. */
export function authDrizzleSchema(options: BetterAuthOptions) {
  const out: Record<string, ReturnType<typeof pgTable>> = {};
  for (const [model, table] of sortedTables(getSchema(options))) {
    const columns: Record<string, PgColumnBuilderBase> = { id: text("id").primaryKey() };
    for (const [key, raw] of Object.entries(table.fields)) {
      const field = raw as AuthField;
      const name = field.fieldName ?? key;
      let col: PgColumnBuilderBase;
      switch (normalizedType(field)) {
        case "number":
          col = doublePrecision(name);
          break;
        case "boolean":
          col = boolean(name);
          break;
        case "date":
          col = timestamp(name, { withTimezone: true, mode: "date" });
          break;
        case "json":
        case "string[]":
        case "number[]":
          col = jsonb(name);
          break;
        default:
          col = text(name);
      }
      columns[key] = col;
    }
    out[model] = pgTable(model, columns);
  }
  return out;
}
