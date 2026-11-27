import type { Where, WhereOperators } from "../adapters/types";
import { XenonError } from "../core/errors";
import type { AnyCollection, Field, FieldsMap, RuntimePopulate, RuntimeSelect } from "../core/types";
import { MAX_POPULATE_DEPTH, validatePopulate, validateSelect } from "../server/populate";

const operators = new Set(["equals", "not_equals", "in", "not_in", "contains", "gt", "gte", "lt", "lte", "exists"]);
const systemFields: Record<string, "string" | "number"> = {
  id: "string", slug: "string", status: "string", createdAt: "string", updatedAt: "string",
};
const uploadFields: Record<string, "string" | "number"> = {
  filename: "string", mimeType: "string", filesize: "number", url: "string", width: "number", height: "number",
};
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const JSON_FIELD_TYPES = new Set(["richText", "json", "group", "array", "blocks"]);

const bad = (message: string): never => { throw new XenonError("BAD_REQUEST", message); };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const MAX_WHERE_DEPTH = 16;

function scalarTypeForField(field: Field): "string" | "number" | "boolean" | "json" {
  if (field.type === "number") return "number";
  if (field.type === "boolean") return "boolean";
  if (JSON_FIELD_TYPES.has(field.type)) return "json";
  return "string";
}

function fieldType(collection: AnyCollection, key: string): "string" | "number" | "boolean" | "json" {
  if (Object.hasOwn(systemFields, key)) return systemFields[key]!;
  if (collection.upload && Object.hasOwn(uploadFields, key)) return uploadFields[key]!;
  const parts = key.split(".");
  if (parts.length > MAX_WHERE_DEPTH || parts.some((p) => !p || FORBIDDEN_PATH_SEGMENTS.has(p))) {
    return bad(`Unknown query field "${key}".`);
  }
  let current = collection.fields as Record<string, Field>;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (!Object.hasOwn(current, seg)) return bad(`Unknown query field "${key}".`);
    const field = current[seg]!;
    if (i === parts.length - 1) return scalarTypeForField(field);
    if (field.type === "group") {
      current = field.fields as Record<string, Field>;
      continue;
    }
    if (field.type === "json") {
      return "json";
    }
    return bad(`Cannot traverse into "${field.type}" field "${parts.slice(0, i + 1).join(".")}".`);
  }
  return bad(`Unknown query field "${key}".`);
}

function coerceBoolean(value: unknown, label: string): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return bad(`${label} must be true or false.`);
}

function assertMaxDepth(value: unknown, label: string, depth: number): void {
  if (depth > MAX_WHERE_DEPTH) bad(`${label} exceeds maximum nesting depth.`);
  if (Array.isArray(value)) {
    for (const item of value) assertMaxDepth(item, label, depth + 1);
  } else if (isObject(value)) {
    for (const entry of Object.values(value)) assertMaxDepth(entry, label, depth + 1);
  }
}

function coerce(value: unknown, type: ReturnType<typeof fieldType>, label: string, depth = 0): unknown {
  if (depth > MAX_WHERE_DEPTH) return bad(`${label} exceeds maximum nesting depth.`);
  if (value === null) return null;
  // JSON arrays/objects participate in deep equality without being flattened or stringified.
  if (Array.isArray(value)) return value.map((item) => coerce(item, type, label, depth + 1));
  if (type === "json" || isObject(value)) {
    assertMaxDepth(value, label, depth);
    return value;
  }
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

export function parseWhere(collection: AnyCollection, input: unknown, depth = 0): Where {
  if (depth > MAX_WHERE_DEPTH) return bad("where filter exceeds maximum nesting depth.");
  if (!isObject(input)) return bad("where must be an object.");
  const result: Where = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "and" || key === "or") {
      if (!Array.isArray(value)) return bad(`where.${key} must be an array.`);
      result[key] = value.map((part) => parseWhere(collection, part, depth + 1));
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

function extractBracketSegments(key: string, prefix: string): string[] {
  const rest = key.slice(prefix.length);
  if (!rest.startsWith("[") || !rest.endsWith("]")) return bad(`Invalid ${prefix} parameter "${key}".`);
  const segments: string[] = [];
  const re = /\[([^\[\]]*)\]/g;
  let consumed = 0;
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    if (m.index !== consumed) return bad(`Invalid ${prefix} parameter "${key}".`);
    const seg = m[1]!;
    if (!seg || FORBIDDEN_PATH_SEGMENTS.has(seg)) return bad(`Invalid ${prefix} parameter "${key}".`);
    segments.push(seg);
    consumed = re.lastIndex;
  }
  if (consumed !== rest.length || segments.length === 0 || segments.length > MAX_WHERE_DEPTH) {
    return bad(`Invalid ${prefix} parameter "${key}".`);
  }
  return segments;
}

function setSelectPath(target: Record<string, unknown>, segments: readonly string[], label: string): void {
  let cursor = target;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (!seg || FORBIDDEN_PATH_SEGMENTS.has(seg)) return bad(`Invalid ${label} field "${segments.join(".")}".`);
    if (i === segments.length - 1) {
      if (Object.hasOwn(cursor, seg) && cursor[seg] !== true) {
        return bad(`Conflicting ${label} specification for "${segments.join(".")}".`);
      }
      cursor[seg] = true;
    } else {
      const existing = Object.hasOwn(cursor, seg) ? cursor[seg] : undefined;
      if (existing === true) {
        return bad(`Conflicting ${label} specification for "${segments.slice(0, i + 1).join(".")}".`);
      }
      if (!isObject(existing)) {
        const next: Record<string, unknown> = {};
        cursor[seg] = next;
        cursor = next;
      } else {
        cursor = existing;
      }
    }
  }
}

function normalizeSelectJson(input: unknown, depth = 0): Record<string, unknown> {
  if (depth > MAX_WHERE_DEPTH) return bad("select exceeds maximum nesting depth.");
  if (!isObject(input)) return bad("select must be an object.");
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) return bad(`Unknown select field "${key}".`);
    if (value === true) {
      out[key] = true;
    } else if (value === false) {
      return bad(`select only supports true (inclusion mode); cannot set "${key}" to false.`);
    } else if (isObject(value)) {
      const nested = normalizeSelectJson(value, depth + 1);
      if (Object.keys(nested).length === 0) return bad(`select.${key} cannot be empty.`);
      out[key] = nested;
    } else {
      return bad(`select.${key} must be true or a nested object.`);
    }
  }
  return out;
}

type ReadFieldContainer = { fields: FieldsMap; upload?: AnyCollection["upload"] };

/** Parse `?select=title,slug`, `?select[title]=true`, `?select[seo][noIndex]=true`, or JSON `?select={...}`. */
export function parseSelect(params: URLSearchParams, collection: ReadFieldContainer): RuntimeSelect | undefined {
  const raw = single(params, "select");
  const bracketKeys = [...new Set([...params.keys()].filter((key) => key.startsWith("select[")))];
  if (raw !== null && bracketKeys.length) return bad("select and bracket select cannot be combined.");
  if (raw === null && bracketKeys.length === 0) return undefined;

  let spec: Record<string, unknown>;
  if (raw !== null) {
    const trimmed = raw.trim();
    if (!trimmed) return bad("select cannot be empty.");
    if (trimmed.startsWith("{")) {
      let parsed: unknown;
      try { parsed = JSON.parse(trimmed); } catch { return bad("select contains invalid JSON."); }
      spec = normalizeSelectJson(parsed);
      if (Object.keys(spec).length === 0) return bad("select cannot be empty.");
    } else if (trimmed.startsWith("[")) {
      return bad("select must be an object or comma-separated field names.");
    } else {
      spec = {};
      for (const token of trimmed.split(",")) {
        const part = token.trim();
        if (!part) return bad("select contains an empty field name.");
        setSelectPath(spec, part.split("."), "select");
      }
    }
  } else {
    spec = {};
    for (const key of bracketKeys) {
      const segments = extractBracketSegments(key, "select");
      const values = params.getAll(key);
      if (values.length > 1) return bad(`${key} must be supplied once.`);
      const enabled = coerceBoolean(values[0], key);
      if (!enabled) return bad(`select only supports true (inclusion mode); cannot set "${key}" to false.`);
      setSelectPath(spec, segments, "select");
    }
  }
  return validateSelect(collection, spec);
}

function normalizePopulateJson(input: unknown, depth = 0): Record<string, unknown> {
  if (depth > MAX_WHERE_DEPTH) return bad("populate exceeds maximum nesting depth.");
  if (!isObject(input)) return bad("populate must be an object.");
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) return bad(`Unknown populate field "${key}".`);
    if (value === true) {
      out[key] = true;
    } else if (value === false) {
      out[key] = false;
    } else if (isObject(value)) {
      out[key] = normalizePopulateJson(value, depth + 1);
    } else {
      return bad(`populate.${key} must be a boolean or an object.`);
    }
  }
  return out;
}

function stripFalsePopulate(
  fields: FieldsMap,
  spec: Record<string, unknown>,
  prefix: string,
  depth: number,
  getCollection?: (slug: string) => AnyCollection | undefined,
): Record<string, unknown> {
  if (depth > MAX_POPULATE_DEPTH) {
    return bad(`populate exceeds maximum depth (${MAX_POPULATE_DEPTH}).`);
  }
  const map = fields as Record<string, Field>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(spec)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(map, key)) return bad(`Unknown populate field "${at}".`);
    const field = map[key]!;
    if (field.type === "relation" || field.type === "media") {
      if (val === false) continue;
      if (depth >= MAX_POPULATE_DEPTH) {
        return bad(`populate exceeds maximum depth (${MAX_POPULATE_DEPTH}).`);
      }
      if (val === true) {
        out[key] = true;
        continue;
      }
      if (!isObject(val)) return bad(`populate.${at} must be true, false, or an options object.`);
      for (const optKey of Object.keys(val)) {
        if (optKey !== "populate" && optKey !== "select") {
          return bad(`Unknown populate option "${optKey}" on "${at}" (use "populate" or "select").`);
        }
      }
      const target = getCollection?.(field.relationTo);
      const branch: Record<string, unknown> = {};
      if (val.select !== undefined) {
        const normalizedSel = normalizeSelectJson(val.select);
        if (Object.keys(normalizedSel).length === 0) return bad(`populate.${at}.select cannot be empty.`);
        branch.select = target ? validateSelect(target, normalizedSel) : normalizedSel;
      }
      if (val.populate !== undefined) {
        if (!isObject(val.populate)) return bad(`populate.${at}.populate must be an object.`);
        const nested = target
          ? stripFalsePopulate(target.fields, val.populate, at, depth + 1, getCollection)
          : stripFalseUntypedPopulate(val.populate, at, depth + 1);
        if (Object.keys(nested).length > 0) branch.populate = nested;
      }
      out[key] = Object.keys(branch).length > 0 ? branch : true;
      continue;
    }
    if (field.type === "group" || field.type === "array") {
      if (val === false) continue;
      if (!isObject(val)) return bad(`populate.${at} must be an object mapping nested fields.`);
      const nested = stripFalsePopulate(field.fields, val, at, depth, getCollection);
      if (Object.keys(nested).length > 0) out[key] = nested;
      continue;
    }
    if (field.type === "blocks") {
      if (val === false) continue;
      if (!isObject(val)) return bad(`populate.${at} must be an object keyed by block slug.`);
      const bySlug = new Map(field.blocks.map((b) => [b.slug, b] as const));
      const blocksOut: Record<string, unknown> = {};
      for (const [blockSlug, blockSpec] of Object.entries(val)) {
        const block = bySlug.get(blockSlug);
        if (!block) return bad(`Unknown block "${blockSlug}" in populate.${at}.`);
        if (blockSpec === false) continue;
        if (!isObject(blockSpec)) return bad(`populate.${at}.${blockSlug} must be an object mapping block fields.`);
        const nested = stripFalsePopulate(block.fields, blockSpec, `${at}.${blockSlug}`, depth, getCollection);
        if (Object.keys(nested).length > 0) blocksOut[blockSlug] = nested;
      }
      if (Object.keys(blocksOut).length > 0) out[key] = blocksOut;
      continue;
    }
    return bad(`Field "${at}" (${field.type}) cannot be populated.`);
  }
  return out;
}

function stripFalseUntypedPopulate(spec: Record<string, unknown>, prefix: string, depth: number): Record<string, unknown> {
  if (depth > MAX_POPULATE_DEPTH) return bad(`populate exceeds maximum depth (${MAX_POPULATE_DEPTH}).`);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(spec)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) return bad(`Unknown populate field "${prefix}.${key}".`);
    if (val === false) continue;
    if (val === true) {
      if (depth >= MAX_POPULATE_DEPTH) return bad(`populate exceeds maximum depth (${MAX_POPULATE_DEPTH}).`);
      out[key] = true;
      continue;
    }
    if (!isObject(val)) return bad(`populate.${prefix}.${key} must be true, false, or an object.`);
    const nested: Record<string, unknown> = {};
    for (const [subKey, subVal] of Object.entries(val)) {
      if (subKey === "select") {
        const sel = normalizeSelectJson(subVal);
        if (Object.keys(sel).length === 0) return bad(`populate.${prefix}.${key}.select cannot be empty.`);
        nested.select = sel;
      } else if (subKey === "populate") {
        if (!isObject(subVal)) return bad(`populate.${prefix}.${key}.populate must be an object.`);
        const p = stripFalseUntypedPopulate(subVal, `${prefix}.${key}`, depth + 1);
        if (Object.keys(p).length > 0) nested.populate = p;
      } else {
        const p = stripFalseUntypedPopulate({ [subKey]: subVal }, `${prefix}.${key}`, depth);
        Object.assign(nested, p);
      }
    }
    out[key] = Object.keys(nested).length > 0 ? nested : true;
  }
  return out;
}

function setPopulatePath(target: Record<string, unknown>, segments: readonly string[], enabled: boolean): void {
  let cursor = target;
  const inSelect = segments.includes("select");
  if (inSelect && !enabled) {
    return bad(`select only supports true (inclusion mode); cannot set "populate[${segments.join("][")}]" to false.`);
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (!seg || FORBIDDEN_PATH_SEGMENTS.has(seg)) return bad(`Invalid populate field "${segments.join(".")}".`);
    if (i === segments.length - 1) {
      const existing = Object.hasOwn(cursor, seg) ? cursor[seg] : undefined;
      if (existing === undefined) {
        cursor[seg] = enabled;
      } else if (isObject(existing)) {
        if (!enabled) return bad(`Conflicting populate specification for "${segments.join(".")}".`);
        // Allow `?populate[author][select][name]=true&populate[author]=true` without clobbering options.
      } else if (existing !== enabled) {
        return bad(`Conflicting populate specification for "${segments.join(".")}".`);
      }
    } else {
      const existing = Object.hasOwn(cursor, seg) ? cursor[seg] : undefined;
      if (existing === false) {
        return bad(`Conflicting populate specification for "${segments.slice(0, i + 1).join(".")}".`);
      }
      if (existing === true || existing === undefined) {
        // Upgrade `?populate[author]=true&populate[author][select][name]=true` into an options object.
        const next: Record<string, unknown> = {};
        cursor[seg] = next;
        cursor = next;
      } else if (isObject(existing)) {
        cursor = existing;
      } else {
        return bad(`Conflicting populate specification for "${segments.slice(0, i + 1).join(".")}".`);
      }
    }
  }
}

/**
 * Parse `?populate[author]=true`, `?populate[author][populate][avatar]=true`,
 * `?populate[author][select][name]=true`, `?populate=author,cover`, or JSON `?populate={...}`.
 */
export function parsePopulate(
  params: URLSearchParams,
  collection: ReadFieldContainer,
  getCollection?: (slug: string) => AnyCollection | undefined,
): RuntimePopulate | undefined {
  const raw = single(params, "populate");
  const bracketKeys = [...new Set([...params.keys()].filter((key) => key.startsWith("populate[")))];
  if (raw !== null && bracketKeys.length) return bad("populate and bracket populate cannot be combined.");
  if (raw === null && bracketKeys.length === 0) return undefined;

  let rawSpec: Record<string, unknown>;
  if (raw !== null) {
    const trimmed = raw.trim();
    if (!trimmed) return bad("populate cannot be empty.");
    if (trimmed.startsWith("{")) {
      let parsed: unknown;
      try { parsed = JSON.parse(trimmed); } catch { return bad("populate contains invalid JSON."); }
      rawSpec = normalizePopulateJson(parsed);
    } else if (trimmed.startsWith("[")) {
      return bad("populate must be an object or comma-separated field names.");
    } else {
      rawSpec = {};
      for (const token of trimmed.split(",")) {
        const part = token.trim();
        if (!part) return bad("populate contains an empty field name.");
        setPopulatePath(rawSpec, part.split("."), true);
      }
    }
  } else {
    rawSpec = {};
    for (const key of bracketKeys) {
      const segments = extractBracketSegments(key, "populate");
      const values = params.getAll(key);
      if (values.length > 1) return bad(`${key} must be supplied once.`);
      const enabled = coerceBoolean(values[0], key);
      setPopulatePath(rawSpec, segments, enabled);
    }
  }

  const cleaned = stripFalsePopulate(collection.fields, rawSpec, "", 0, getCollection);
  if (Object.keys(cleaned).length === 0) return undefined;
  if (getCollection) {
    return validatePopulate(collection, cleaned, getCollection).spec;
  }
  return cleaned as RuntimePopulate;
}

export interface ParsedReadQuery {
  draft: boolean;
  select?: RuntimeSelect;
  populate?: RuntimePopulate;
}

/** Parse read options shared by single-document and global GET (`draft`, `select`, `populate`). */
export function parseReadQuery(
  params: URLSearchParams,
  collection: ReadFieldContainer,
  getCollection?: (slug: string) => AnyCollection | undefined,
): ParsedReadQuery {
  const select = parseSelect(params, collection);
  const populate = parsePopulate(params, collection, getCollection);
  return {
    draft: parseDraft(params),
    ...(select ? { select } : {}),
    ...(populate ? { populate } : {}),
  };
}

export interface ParsedQuery extends ParsedReadQuery {
  where?: Where;
  sort?: string;
  limit: number;
  page: number;
}

/** Parse the REST query grammar without touching auth, Next.js, or a database. */
export function parseQuery(
  params: URLSearchParams,
  collection: AnyCollection,
  getCollection?: (slug: string) => AnyCollection | undefined,
): ParsedQuery {
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
      const value = operator === "in" || operator === "not_in"
        ? values.flatMap((entry) => (entry === "" ? [] : entry.split(",")))
        : values[0];
      input[field] ??= Object.create(null);
      input[field]![operator] = value;
    }
    where = parseWhere(collection, input);
  }
  const sort = single(params, "sort");
  if (sort !== null) fieldType(collection, sort.startsWith("-") ? sort.slice(1) : sort);
  const limit = integer(single(params, "limit"), 10, 0, "limit");
  const read = parseReadQuery(params, collection, getCollection);
  return {
    ...(where ? { where } : {}),
    ...(sort !== null ? { sort } : {}),
    limit: limit === 0 ? 100 : Math.min(limit, 100),
    page: integer(single(params, "page"), 1, 1, "page"),
    ...read,
  };
}
