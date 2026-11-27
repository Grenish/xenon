import { z } from "zod";
import { evaluateCondition } from "./condition";
import { newRowId } from "./row-id";
import type {
  AnyBlock,
  AnyCollection,
  Field,
  FieldCondition,
  FieldsMap,
  InferCreateInput,
  InferDraftInput,
  InferUpdateInput,
  RichTextDocument,
  SelectOption,
  StandardSchemaV1,
} from "./types";

export { newRowId };

export type ValidationMode = "create" | "update" | "draft";

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

type ModeOutput<C extends AnyCollection, M extends ValidationMode> = M extends "create"
  ? InferCreateInput<C>
  : M extends "update"
    ? InferUpdateInput<C>
    : InferDraftInput<C>;

export function selectOptionValues(options: readonly SelectOption[]): string[] {
  return options.map((o) => (typeof o === "string" ? o : o.value));
}

const richTextSchema = z.looseObject({
  type: z.literal("doc"),
  content: z.array(z.looseObject({ type: z.string().min(1) })).optional(),
}) as unknown as z.ZodType<RichTextDocument>;

function many(field: { hasMany?: boolean }, item: z.ZodType, unique: boolean): z.ZodType {
  if (!field.hasMany) return item;
  const arr = z.array(item);
  return unique
    ? arr.refine((v) => new Set(v).size === v.length, { message: "Duplicate values are not allowed" })
    : arr;
}

/* -------------------------------------------------------------------------- */
/*                              Scalar primitives                             */
/* -------------------------------------------------------------------------- */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` naming a real calendar day. */
export function isCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const isoDateTime = z.iso.datetime({ offset: true });

/** Normalizes a `datetime()` value to `toISOString()` form, or `null` when it is not an ISO timestamp. */
export function normalizeDateTime(value: string): string | null {
  if (!isoDateTime.safeParse(value).success) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function dateSchema(field: Extract<Field, { type: "date" }>): z.ZodType {
  const time = field.time === true;
  const norm = (v: string) => (time ? normalizeDateTime(v) : isCalendarDate(v) ? v : null);
  const min = field.min !== undefined ? norm(field.min) : null;
  const max = field.max !== undefined ? norm(field.max) : null;
  return z.string().transform((value, ctx) => {
    const out = norm(value);
    if (out === null) {
      ctx.addIssue({
        code: "custom",
        message: time ? "Expected an ISO-8601 date and time" : "Expected a date (YYYY-MM-DD)",
      });
      return z.NEVER;
    }
    // Same-format ISO strings order lexicographically.
    if (min !== null && out < min) ctx.addIssue({ code: "custom", message: `Must be on or after ${field.min}` });
    if (max !== null && out > max) ctx.addIssue({ code: "custom", message: `Must be on or before ${field.max}` });
    return out;
  });
}

function urlSchema(field: Extract<Field, { type: "url" }>): z.ZodType {
  const protocols = new Set((field.protocols ?? ["http", "https"]).map((p) => p.toLowerCase().replace(/:$/, "")));
  return z.string().superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Expected a URL" });
      return;
    }
    if (!protocols.has(parsed.protocol.slice(0, -1).toLowerCase())) {
      ctx.addIssue({ code: "custom", message: `URL must start with ${[...protocols].map((p) => `${p}:`).join(" or ")}` });
    }
  });
}

const MAX_JSON_DEPTH = 64;

/** Plain JSON only: no `undefined`, functions, class instances, non-finite numbers or cycles. */
export function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isJsonValue(v, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every((v) => isJsonValue(v, depth + 1));
  }
  return false;
}

function standardPath(path: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined): (string | number)[] {
  return (path ?? []).map((p) => {
    const key = typeof p === "object" ? p.key : p;
    return typeof key === "number" ? key : String(key);
  });
}

function jsonSchema(field: Extract<Field, { type: "json" }>): z.ZodType {
  const schema: StandardSchemaV1 | undefined = field.schema;
  return z.unknown().transform((value, ctx) => {
    if (!isJsonValue(value)) {
      ctx.addIssue({ code: "custom", message: "Expected a JSON value" });
      return z.NEVER;
    }
    if (!schema) return value;
    const result = schema["~standard"].validate(value);
    if (result instanceof Promise) {
      throw new Error("[xenon] json() schemas must validate synchronously.");
    }
    const r = result as { value?: unknown; issues?: readonly { message: string; path?: readonly (PropertyKey | { key: PropertyKey })[] }[] };
    if (r.issues) {
      for (const issue of r.issues) ctx.addIssue({ code: "custom", message: issue.message, path: standardPath(issue.path) });
      return z.NEVER;
    }
    return r.value;
  });
}

/* -------------------------------------------------------------------------- */
/*                               Nested fields                                */
/* -------------------------------------------------------------------------- */

/** Composite values replace their stored value wholesale, so nested fields are checked in full on update. */
const nestedMode = (mode: ValidationMode): ValidationMode => (mode === "update" ? "create" : mode);

/** `group` → `{}`, `array` / `blocks` → `[]`: what a container holds when nothing is stored. */
export function containerDefault(field: Field): Record<string, never> | never[] | undefined {
  if (field.type === "group") return {};
  if (field.type === "array" || field.type === "blocks") return [];
  return undefined;
}

const rowIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, { message: "Invalid row id" });

function rowsSchema(
  field: { required?: boolean; minRows?: number; maxRows?: number },
  mode: ValidationMode,
  item: z.ZodType,
): z.ZodType {
  const min = mode === "draft" ? 0 : Math.max(field.minRows ?? 0, field.required ? 1 : 0);
  return z.array(item).superRefine((rows, ctx) => {
    if (rows.length < min) {
      ctx.addIssue({
        code: "custom",
        message: field.required && min === 1 ? "This field is required" : `Add at least ${min} ${min === 1 ? "item" : "items"}`,
      });
    }
    if (field.maxRows !== undefined && rows.length > field.maxRows) {
      ctx.addIssue({ code: "custom", message: `Use ${field.maxRows} ${field.maxRows === 1 ? "item" : "items"} or fewer` });
    }
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const id = (row as { id?: unknown }).id;
      if (typeof id !== "string") return;
      if (seen.has(id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "Duplicate row id" });
      seen.add(id);
    });
  });
}

function blocksItemSchema(blocks: readonly AnyBlock[], mode: ValidationMode): z.ZodType {
  const bySlug = new Map(blocks.map((b) => [b.slug, b] as const));
  const schemas = new Map<string, z.ZodType>();
  return z.unknown().transform((value, ctx) => {
    const blockType = typeof value === "object" && value !== null ? (value as { blockType?: unknown }).blockType : undefined;
    const block = typeof blockType === "string" ? bySlug.get(blockType) : undefined;
    if (!block) {
      ctx.addIssue({
        code: "custom",
        path: ["blockType"],
        message: `Expected one of: ${blocks.map((b) => b.slug).join(", ")}`,
      });
      return z.NEVER;
    }
    let schema = schemas.get(block.slug);
    if (!schema) schemas.set(block.slug, (schema = fieldsSchema(block.fields, mode, { row: true, blockType: block.slug })));
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, input: undefined } as never);
      return z.NEVER;
    }
    return parsed.data;
  });
}

/** Schema for a single (non-null) field value, ignoring required/default semantics. */
export function fieldValueSchema(field: Field, mode: ValidationMode = "create"): z.ZodType {
  switch (field.type) {
    case "text": {
      let s = z.string();
      if (field.minLength !== undefined) s = s.min(field.minLength);
      if (field.maxLength !== undefined) s = s.max(field.maxLength);
      if (field.pattern) s = s.regex(field.pattern);
      return s;
    }
    case "textarea": {
      let s = z.string();
      if (field.minLength !== undefined) s = s.min(field.minLength);
      if (field.maxLength !== undefined) s = s.max(field.maxLength);
      return s;
    }
    case "number": {
      let s = z.number();
      if (field.integer) s = s.int();
      if (field.min !== undefined) s = s.gte(field.min);
      if (field.max !== undefined) s = s.lte(field.max);
      return s;
    }
    case "boolean":
      return z.boolean();
    case "select": {
      const values = selectOptionValues(field.options);
      return many(field, z.enum(values as [string, ...string[]]), true);
    }
    case "richText":
      return richTextSchema;
    case "media":
    case "relation":
      return many(field, z.string().min(1, { message: "Expected a document id" }), false);
    case "date":
      return dateSchema(field);
    case "email":
      return z.email({ message: "Expected an email address" });
    case "url":
      return urlSchema(field);
    case "json":
      return jsonSchema(field);
    case "group":
      return fieldsSchema(field.fields, nestedMode(mode));
    case "array":
      return rowsSchema(field, mode, fieldsSchema(field.fields, nestedMode(mode), { row: true }));
    case "blocks":
      return rowsSchema(field, mode, blocksItemSchema(field.blocks, nestedMode(mode)));
    default: {
      const unknownField: never = field;
      throw new Error(`[xenon] Unknown field type: ${JSON.stringify(unknownField)}`);
    }
  }
}

/** Validates a single value against a field's built-in rules. Returns an error message or `null`. */
export function validateFieldValue(field: Field, value: unknown): string | null {
  const result = fieldValueSchema(field).safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid value");
}

function fieldSchema(field: Field, mode: ValidationMode): z.ZodType {
  const base = fieldValueSchema(field, mode);
  if (mode === "draft") return base.nullable().optional();
  if (field.required || (field.type === "group" && hasRequiredFields(field.fields))) {
    return mode === "update" ? base.optional() : base;
  }
  return base.nullable().optional();
}

/** Whether any field (recursively through groups) must be supplied on create. */
function hasRequiredFields(fields: FieldsMap): boolean {
  return Object.values(fields).some(
    (f) => (f.type === "group" ? hasRequiredFields(f.fields) : f.required === true && f.defaultValue === undefined),
  );
}

function cloneDefault<T>(value: T): T {
  return typeof value === "object" && value !== null ? structuredClone(value) : value;
}

/**
 * Normalizes input before validation:
 * - `null` on a field with a `defaultValue` (or on a container) becomes the default, in any mode, so
 *   such fields never read as null;
 * - missing keys get their default in `create` / `draft` mode.
 */
function applyDefaults(fields: Record<string, Field>, mode: ValidationMode, input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const [key, field] of Object.entries(fields)) {
    const fallback = field.defaultValue !== undefined ? field.defaultValue : containerDefault(field);
    if (fallback === undefined) continue;
    const v = out[key];
    if (v === null || (v === undefined && mode !== "update")) out[key] = cloneDefault(fallback);
  }
  return out;
}

interface ObjectExtras {
  /** An `array` row / `blocks` item: accepts (and fills in) an `id`. */
  row?: boolean;
  /** A `blocks` item of this type: accepts `blockType`. */
  blockType?: string;
}

/**
 * The schema for an object of fields (a collection's data, a group, an array row or a block). Built-in
 * checks and custom `validate` hooks run in a single pass, so every error is reported at once. (Zod's
 * object-level refinements are skipped once a nested check aborts.) Unknown keys are rejected.
 */
export function fieldsSchema(fieldsMap: FieldsMap, mode: ValidationMode, extras: ObjectExtras = {}): z.ZodType {
  const fields = fieldsMap as Record<string, Field>;
  const shape: Record<string, z.ZodType> = {};
  // Fields with an `admin.condition` are checked after the object parse, against their siblings:
  // shown → the field's normal rules; hidden → draft rules (type/format only, no required or minimums).
  const conditional = new Map<string, { condition: FieldCondition; shown: z.ZodType; hidden: z.ZodType }>();
  for (const [key, field] of Object.entries(fields)) {
    const condition = field.admin?.condition;
    if (condition === undefined) {
      shape[key] = fieldSchema(field, mode);
    } else {
      shape[key] = z.unknown().optional();
      conditional.set(key, { condition, shown: fieldSchema(field, mode), hidden: fieldSchema(field, "draft") });
    }
  }
  if (extras.row) shape.id = rowIdSchema.optional();
  if (extras.blockType !== undefined) shape.blockType = z.literal(extras.blockType);
  const objectSchema = z.strictObject(shape);

  return z.preprocess(
    (input) => applyDefaults(fields, mode, input),
    z.unknown().transform((input, ctx) => {
      const parsed = objectSchema.safeParse(input);
      let ok = parsed.success;
      const record = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
      const isMissing = (key: unknown) =>
        typeof key === "string" && Object.hasOwn(fields, key) && (record?.[key] === undefined || record?.[key] === null);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          // A missing / null value on a required field reads better as "required" than as a type error.
          const key = issue.path.length === 1 ? issue.path[0] : undefined;
          ctx.addIssue({ ...issue, message: isMissing(key) ? "This field is required" : issue.message, input: undefined } as never);
        }
      }
      const out: Record<string, unknown> = parsed.success ? { ...(parsed.data as Record<string, unknown>) } : {};
      const hiddenKeys = new Set<string>();
      if (record) {
        for (const [key, rule] of conditional) {
          const shown = evaluateCondition(rule.condition, record);
          if (!shown) hiddenKeys.add(key);
          const result = (shown ? rule.shown : rule.hidden).safeParse(record[key]);
          if (result.success) {
            if (result.data === undefined) delete out[key];
            else out[key] = result.data;
            continue;
          }
          ok = false;
          for (const issue of result.error.issues) {
            const message = issue.path.length === 0 && isMissing(key) ? "This field is required" : issue.message;
            ctx.addIssue({ ...issue, path: [key, ...issue.path], message, input: undefined } as never);
          }
        }
        for (const [key, field] of Object.entries(fields)) {
          const value = record[key];
          if (!field.validate || value === undefined || value === null || hiddenKeys.has(key)) continue;
          const builtIn = conditional.get(key)?.shown ?? shape[key]!;
          if (!builtIn.safeParse(value).success) continue; // built-in check already failed
          const validate = field.validate as (v: unknown, c: { data: Record<string, unknown> }) => true | string;
          const res = validate(value, { data: record });
          if (res !== true) {
            ok = false;
            ctx.addIssue({ code: "custom", path: [key], message: res, input: value });
          }
        }
      }
      if (!ok || !parsed.success) return z.NEVER;
      if (extras.row && out.id === undefined) return { id: newRowId(), ...out };
      return out;
    }),
  );
}

const schemaCache = new WeakMap<AnyCollection, Map<ValidationMode, z.ZodType>>();

/**
 * Builds (and caches) a Zod schema for a collection's input data.
 * Unknown keys — including managed upload fields — are rejected.
 */
export function buildCollectionSchema<C extends AnyCollection, M extends ValidationMode>(
  collection: C,
  options: { mode: M },
): z.ZodType<ModeOutput<C, M>> {
  const { mode } = options;
  let byMode = schemaCache.get(collection);
  const cached = byMode?.get(mode);
  if (cached) return cached as z.ZodType<ModeOutput<C, M>>;

  const schema = fieldsSchema(collection.fields, mode);
  if (!byMode) schemaCache.set(collection, (byMode = new Map()));
  byMode.set(mode, schema);
  return schema as unknown as z.ZodType<ModeOutput<C, M>>;
}

/** Validates input data for a collection. Never throws for invalid data. */
export function validateCollectionData<C extends AnyCollection, M extends ValidationMode>(
  collection: C,
  input: unknown,
  options: { mode: M },
): ValidationResult<ModeOutput<C, M>> {
  const result = buildCollectionSchema(collection, options).safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    issues: result.error.issues.map((i) => ({
      path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
      message: i.message,
    })),
  };
}
