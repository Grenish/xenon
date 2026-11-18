import { z } from "zod";
import type {
  AnyCollection,
  Field,
  InferCreateInput,
  InferDraftInput,
  InferUpdateInput,
  RichTextDocument,
  SelectOption,
} from "./types";

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

/** Schema for a single (non-null) field value, ignoring required/default semantics. */
export function fieldValueSchema(field: Field): z.ZodType {
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
  const base = fieldValueSchema(field);
  if (mode === "draft") return base.nullable().optional();
  if (field.required) return mode === "update" ? base.optional() : base;
  return base.nullable().optional();
}

function cloneDefault<T>(value: T): T {
  return typeof value === "object" && value !== null ? structuredClone(value) : value;
}

/**
 * Normalizes input before validation:
 * - `null` on a field with a `defaultValue` becomes the default (any mode), so such fields never read as null;
 * - missing keys get their `defaultValue` in `create` / `draft` mode.
 */
function applyDefaults(fields: Record<string, Field>, mode: ValidationMode, input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const [key, field] of Object.entries(fields)) {
    if (field.defaultValue === undefined) continue;
    const v = out[key];
    if (v === null || (v === undefined && mode !== "update")) {
      out[key] = cloneDefault(field.defaultValue);
    }
  }
  return out;
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

  const fields = collection.fields as Record<string, Field>;
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) shape[key] = fieldSchema(field, mode);
  const objectSchema = z.strictObject(shape);

  // Built-in checks and custom `validate` hooks run in a single pass, so every error is reported
  // at once. (Zod's object-level refinements are skipped once a nested check aborts.)
  const schema = z.preprocess(
    (input) => applyDefaults(fields, mode, input),
    z.unknown().transform((input, ctx) => {
      const parsed = objectSchema.safeParse(input);
      let ok = parsed.success;
      if (!parsed.success) {
        const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
        for (const issue of parsed.error.issues) {
          // A missing / null value on a required field reads better as "required" than as a type error.
          const key = issue.path.length === 1 ? issue.path[0] : undefined;
          const missing =
            typeof key === "string" && key in fields && (record[key] === undefined || record[key] === null);
          const message = missing ? "This field is required" : issue.message;
          ctx.addIssue({ ...issue, message, input: undefined } as never);
        }
      }
      if (typeof input === "object" && input !== null && !Array.isArray(input)) {
        const record = input as Record<string, unknown>;
        for (const [key, field] of Object.entries(fields)) {
          const value = record[key];
          if (!field.validate || value === undefined || value === null) continue;
          if (!shape[key]!.safeParse(value).success) continue; // built-in check already failed
          const validate = field.validate as (v: unknown, c: { data: Record<string, unknown> }) => true | string;
          const res = validate(value, { data: record });
          if (res !== true) {
            ok = false;
            ctx.addIssue({ code: "custom", path: [key], message: res, input: value });
          }
        }
      }
      return ok && parsed.success ? parsed.data : z.NEVER;
    }),
  );

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
