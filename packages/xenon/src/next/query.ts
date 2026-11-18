import type { Where, WhereOperators } from "../adapters/types";
import { XenonError } from "../core/errors";
import type { AnyCollection, Field } from "../core/types";

const operators = new Set(["equals", "not_equals", "in", "not_in", "contains", "gt", "gte", "lt", "lte", "exists"]);
const systemFields: Record<string, "string" | "number"> = {
  id: "string", slug: "string", status: "string", createdAt: "string", updatedAt: "string",
};
const uploadFields: Record<string, "string" | "number"> = {
  filename: "string", mimeType: "string", filesize: "number", url: "string", width: "number", height: "number",
};
const bad = (message: string): never => { throw new XenonError("BAD_REQUEST", message); };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function fieldType(collection: AnyCollection, key: string): "string" | "number" | "boolean" | "json" {
  if (Object.hasOwn(systemFields, key)) return systemFields[key]!;
  if (collection.upload && Object.hasOwn(uploadFields, key)) return uploadFields[key]!;
  if (!Object.hasOwn(collection.fields, key)) return bad(`Unknown query field "${key}".`);
  const field = collection.fields[key] as Field;
  return field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : field.type === "richText" ? "json" : "string";
}

function coerceBoolean(value: unknown, label: string): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return bad(`${label} must be true or false.`);
}

function coerce(value: unknown, type: ReturnType<typeof fieldType>, label: string): unknown {
  if (value === null) return null;
  // JSON arrays/objects participate in deep equality without being flattened or stringified.
  if (Array.isArray(value)) return value.map((item) => coerce(item, type, label));
  if (type === "json" || isObject(value)) return value;
  if (type === "number") {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return bad(`${label} must be a finite number.`);
    const number = Number(value);
    if (!Number.isFinite(number)) return bad(`${label} must be a finite number.`);
    return number;
  }
  if (type === "boolean") return coerceBoolean(value, label);
  if (typeof value !== "string") return bad(`${label} must be a string.`);
  return value;
}

function parseOperators(collection: AnyCollection, key: string, input: unknown): WhereOperators {
  const type = fieldType(collection, key);
  if (!isObject(input)) return bad(`where.${key} must be an operators object.`);
  const result: WhereOperators = {};
  for (const [operator, value] of Object.entries(input)) {
    if (!operators.has(operator)) return bad(`Unknown where operator "${operator}".`);
    let parsed: unknown;
    if (operator === "exists") parsed = coerceBoolean(value, `where.${key}.exists`);
    else if (operator === "in" || operator === "not_in") {
      if (!Array.isArray(value)) return bad(`where.${key}.${operator} must be an array.`);
      parsed = value.map((item) => coerce(item, type, `where.${key}.${operator}`));
    } else {
      parsed = coerce(value, type, `where.${key}.${operator}`);
      if (["gt", "gte", "lt", "lte"].includes(operator) && typeof parsed !== "number" && typeof parsed !== "string") {
        return bad(`where.${key}.${operator} must be a number or string.`);
      }
    }
    Object.assign(result, { [operator]: parsed });
  }
  return result;
}

export function parseWhere(collection: AnyCollection, input: unknown): Where {
  if (!isObject(input)) return bad("where must be an object.");
  const result: Where = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "and" || key === "or") {
      if (!Array.isArray(value)) return bad(`where.${key} must be an array.`);
      result[key] = value.map((part) => parseWhere(collection, part));
    } else {
      // defineProperty avoids treating __proto__ specially in untrusted query input.
      Object.defineProperty(result, key, { value: parseOperators(collection, key, value), enumerable: true, writable: true, configurable: true });
    }
  }
  return result;
}

function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) return bad(`${key} must be supplied once.`);
  return values[0] ?? null;
}

function integer(value: string | null, fallback: number, minimum: number, label: string): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return bad(`${label} must be an integer >= ${minimum}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return bad(`${label} must be an integer >= ${minimum}.`);
  return parsed;
}

export function parseDraft(params: URLSearchParams): boolean {
  const value = single(params, "draft");
  return value === null ? false : coerceBoolean(value, "draft");
}

export interface ParsedQuery {
  where?: Where;
  sort?: string;
  limit: number;
  page: number;
  draft: boolean;
}

/** Parse the REST query grammar without touching auth, Next.js, or a database. */
export function parseQuery(params: URLSearchParams, collection: AnyCollection): ParsedQuery {
  const json = single(params, "where");
  const bracketKeys = [...new Set([...params.keys()].filter((key) => key.startsWith("where[")))];
  if (json !== null && bracketKeys.length) return bad("JSON where and bracket where cannot be combined.");
  let where: Where | undefined;
  if (json !== null) {
    let input: unknown;
    try { input = JSON.parse(json); } catch { return bad("where contains invalid JSON."); }
    where = parseWhere(collection, input);
  } else if (bracketKeys.length) {
    const input: Record<string, Record<string, unknown>> = Object.create(null);
    for (const key of bracketKeys) {
      const match = /^where\[([^\[\]]+)\]\[([^\[\]]+)\]$/.exec(key);
      if (!match) return bad(`Invalid where parameter "${key}".`);
      const field = match[1]!;
      const operator = match[2]!;
      const values = params.getAll(key);
      if (operator !== "in" && operator !== "not_in" && values.length > 1) return bad(`${key} must be supplied once.`);
      const value = operator === "in" || operator === "not_in" ? values.flatMap((entry) => entry.split(",")) : values[0];
      input[field] ??= Object.create(null);
      input[field]![operator] = value;
    }
    where = parseWhere(collection, input);
  }
  const sort = single(params, "sort");
  if (sort !== null) fieldType(collection, sort.startsWith("-") ? sort.slice(1) : sort);
  const limit = integer(single(params, "limit"), 10, 0, "limit");
  return {
    ...(where ? { where } : {}), ...(sort !== null ? { sort } : {}),
    limit: limit === 0 ? 100 : Math.min(limit, 100),
    page: integer(single(params, "page"), 1, 1, "page"), draft: parseDraft(params),
  };
}
