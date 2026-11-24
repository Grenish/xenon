import { type SQL, sql } from "drizzle-orm";
import type { FindArgs, Where, WhereOperators } from "../types";
import { xenonDocuments as t } from "./schema";

/*
 * Compiles the adapter `Where` language (CONTRACTS §2.1) to SQL over `xenon_documents`.
 * Data fields are addressed as jsonb (`source -> 'key'`); "missing" = SQL NULL or JSON null.
 */

const TRUE = sql`true`;
const FALSE = sql`false`;

type ColumnKind = "text" | "date";
const SYSTEM_COLUMNS: Record<string, { col: SQL; kind: ColumnKind } | undefined> = {
  id: { col: sql`${t.id}`, kind: "text" },
  slug: { col: sql`${t.slug}`, kind: "text" },
  status: { col: sql`${t.status}`, kind: "text" },
  createdAt: { col: sql`${t.createdAt}`, kind: "date" },
  updatedAt: { col: sql`${t.updatedAt}`, kind: "date" },
};

function sourceExpr(source: FindArgs["source"]): SQL {
  return source === "draft" ? sql`coalesce(${t.draftData}, ${t.data})` : sql`${t.data}`;
}

const and = (parts: SQL[]): SQL =>
  parts.length === 0 ? TRUE : parts.length === 1 ? parts[0]! : sql`(${sql.join(parts, sql` and `)})`;
const or = (parts: SQL[]): SQL =>
  parts.length === 0 ? FALSE : parts.length === 1 ? parts[0]! : sql`(${sql.join(parts, sql` or `)})`;
const not = (part: SQL): SQL => sql`(not coalesce(${part}, false))`;

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

const jsonParam = (v: unknown): SQL => sql`${JSON.stringify(v)}::jsonb`;

/* ---------------------------------- jsonb --------------------------------- */

function jsonMissing(x: SQL): SQL {
  return sql`(${x} is null or ${x} = 'null'::jsonb)`;
}

function jsonEquals(x: SQL, v: unknown): SQL {
  if (v === null || v === undefined) return jsonMissing(x);
  return sql`coalesce(${x} = ${jsonParam(v)}, false)`;
}

function jsonCompare(x: SQL, op: ">" | ">=" | "<" | "<=", v: unknown): SQL {
  const o = sql.raw(op);
  if (typeof v === "number" && Number.isFinite(v)) {
    // CASE guarantees the cast only runs on numbers (AND does not short-circuit in SQL).
    return sql`(case when jsonb_typeof(${x}) = 'number' then (${x})::numeric ${o} ${v} else false end)`;
  }
  if (typeof v === "string") {
    return sql`(case when jsonb_typeof(${x}) = 'string' then (${x} #>> '{}') collate "C" ${o} ${v} collate "C" else false end)`;
  }
  return FALSE;
}

function jsonContains(x: SQL, v: unknown): SQL {
  const arr = sql`(jsonb_typeof(${x}) = 'array' and ${x} @> jsonb_build_array(${jsonParam(v)}))`;
  if (typeof v !== "string") return v === undefined ? FALSE : arr;
  const str = sql`(jsonb_typeof(${x}) = 'string' and (${x} #>> '{}') ilike ${`%${escapeLike(v)}%`})`;
  return sql`(${str} or ${arr})`;
}

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/**
 * `data @> {"key": v}` — equivalent to `data -> key = v` for a scalar `v` (a nested array never
 * contains a bare scalar), but able to use the `jsonb_path_ops` GIN index on published `data`.
 */
function jsonContainment(key: string, v: unknown): SQL | null {
  return isScalar(v) ? sql`(${t.data} @> ${jsonParam({ [key]: v })})` : null;
}

function jsonOps(x: SQL, ops: WhereOperators, key: string | null): SQL[] {
  const eq = (v: unknown): SQL => (key !== null && jsonContainment(key, v)) || jsonEquals(x, v);
  const parts: SQL[] = [];
  if ("equals" in ops) parts.push(eq(ops.equals));
  if ("not_equals" in ops) parts.push(not(jsonEquals(x, ops.not_equals)));
  if (ops.in) parts.push(or(ops.in.map(eq)));
  if (ops.not_in) parts.push(not(or(ops.not_in.map((v) => jsonEquals(x, v)))));
  if ("contains" in ops) parts.push(jsonContains(x, ops.contains));
  if (ops.gt !== undefined) parts.push(jsonCompare(x, ">", ops.gt));
  if (ops.gte !== undefined) parts.push(jsonCompare(x, ">=", ops.gte));
  if (ops.lt !== undefined) parts.push(jsonCompare(x, "<", ops.lt));
  if (ops.lte !== undefined) parts.push(jsonCompare(x, "<=", ops.lte));
  if (ops.exists !== undefined) parts.push(ops.exists ? not(jsonMissing(x)) : jsonMissing(x));
  return parts;
}

/* --------------------------------- columns -------------------------------- */

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function columnEquals(col: SQL, kind: ColumnKind, v: unknown): SQL {
  if (v === null || v === undefined) return sql`(${col} is null)`;
  if (kind === "date") {
    const d = toDate(v);
    return d ? sql`coalesce(${col} = ${d.toISOString()}::timestamptz, false)` : FALSE;
  }
  return typeof v === "string" ? sql`coalesce(${col} = ${v}, false)` : FALSE;
}

function columnCompare(col: SQL, kind: ColumnKind, op: ">" | ">=" | "<" | "<=", v: unknown): SQL {
  const o = sql.raw(op);
  if (kind === "date") {
    const d = toDate(v);
    return d ? sql`coalesce(${col} ${o} ${d.toISOString()}::timestamptz, false)` : FALSE;
  }
  return typeof v === "string" ? sql`coalesce(${col} collate "C" ${o} ${v} collate "C", false)` : FALSE;
}

function columnOps(col: SQL, kind: ColumnKind, ops: WhereOperators): SQL[] {
  const parts: SQL[] = [];
  if ("equals" in ops) parts.push(columnEquals(col, kind, ops.equals));
  if ("not_equals" in ops) parts.push(not(columnEquals(col, kind, ops.not_equals)));
  if (ops.in) parts.push(or(ops.in.map((v) => columnEquals(col, kind, v))));
  if (ops.not_in) parts.push(not(or(ops.not_in.map((v) => columnEquals(col, kind, v)))));
  if ("contains" in ops) {
    parts.push(
      kind === "text" && typeof ops.contains === "string"
        ? sql`coalesce(${col} ilike ${`%${escapeLike(ops.contains)}%`}, false)`
        : FALSE,
    );
  }
  if (ops.gt !== undefined) parts.push(columnCompare(col, kind, ">", ops.gt));
  if (ops.gte !== undefined) parts.push(columnCompare(col, kind, ">=", ops.gte));
  if (ops.lt !== undefined) parts.push(columnCompare(col, kind, "<", ops.lt));
  if (ops.lte !== undefined) parts.push(columnCompare(col, kind, "<=", ops.lte));
  if (ops.exists !== undefined) parts.push(ops.exists ? sql`(${col} is not null)` : sql`(${col} is null)`);
  return parts;
}

/* ---------------------------------- where --------------------------------- */

export function compileWhere(where: Where | undefined, source: FindArgs["source"]): SQL {
  if (!where) return TRUE;
  const src = sourceExpr(source);
  const parts: SQL[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === "and" || key === "or") {
      const nested = (value as Where[]).map((w) => compileWhere(w, source));
      parts.push(key === "and" ? and(nested) : or(nested));
      continue;
    }
    const ops = value as WhereOperators;
    const system = Object.hasOwn(SYSTEM_COLUMNS, key) ? SYSTEM_COLUMNS[key] : undefined;
    // Only published reads address the bare `data` column the GIN index covers.
    const indexKey = source === "draft" ? null : key;
    parts.push(and(system ? columnOps(system.col, system.kind, ops) : jsonOps(sql`(${src} -> ${key})`, ops, indexKey)));
  }
  return and(parts);
}

/* ---------------------------------- sort ---------------------------------- */

export function compileOrderBy(sort: string | undefined, source: FindArgs["source"]): SQL {
  const raw = sort?.trim() || "-createdAt";
  const desc = raw.startsWith("-");
  const key = desc ? raw.slice(1) : raw;
  const dir = sql.raw(desc ? "desc" : "asc");
  const tie = sql`${t.id} collate "C" asc`;

  const system = Object.hasOwn(SYSTEM_COLUMNS, key) ? SYSTEM_COLUMNS[key] : undefined;
  if (system) {
    const col = system.kind === "text" ? sql`${system.col} collate "C"` : system.col;
    return sql`(${system.col} is null) asc, ${col} ${dir}, ${tie}`;
  }
  const x = sql`(${sourceExpr(source)} -> ${key})`;
  return sql`${jsonMissing(x)} asc,
    case when jsonb_typeof(${x}) = 'number' then (${x})::numeric end ${dir},
    case when jsonb_typeof(${x}) = 'string' then (${x} #>> '{}') end collate "C" ${dir},
    case when jsonb_typeof(${x}) = 'boolean' then (${x})::boolean end ${dir},
    ${tie}`;
}
