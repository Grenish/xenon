import type { AnyCollection, Field, XenonConfig, XenonConfigInput } from "./types";
import { SYSTEM_KEYS, UPLOAD_KEYS } from "./types";
import { selectOptionValues, validateFieldValue } from "./validation";

export class XenonConfigError extends Error {
  override name = "XenonConfigError";
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const RESERVED_KEYS = new Set<string>(SYSTEM_KEYS);
/** Collide with REST routes (`{api}/auth/*`). `_`-prefixed slugs are already invalid. */
const RESERVED_COLLECTION_SLUGS = new Set(["auth"]);
const UPLOAD_KEY_SET = new Set<string>(UPLOAD_KEYS);

function fail(collection: string, path: string | null, message: string): never {
  const where = path ? `collection "${collection}" → field "${path}"` : `collection "${collection}"`;
  throw new XenonConfigError(`[xenon] Invalid config in ${where}: ${message}`);
}

function isUploadCollection(c: AnyCollection): boolean {
  return c.upload !== undefined && c.upload !== false;
}

const BLOCK_SLUG_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const ROW_KEYS = new Set(["id"]);
const BLOCK_KEYS = new Set(["id", "blockType"]);

function validateRows(slug: string, path: string, field: { minRows?: number; maxRows?: number }): void {
  for (const k of ["minRows", "maxRows"] as const) {
    const v = field[k];
    if (v !== undefined && (!Number.isInteger(v) || v < 0)) fail(slug, path, `${k} must be a non-negative integer.`);
  }
  if (field.minRows !== undefined && field.maxRows !== undefined && field.minRows > field.maxRows) {
    fail(slug, path, `minRows (${field.minRows}) is greater than maxRows (${field.maxRows}).`);
  }
}

/**
 * Validates a map of fields. `path` is the dotted path of the containing field (`""` at the top level);
 * `reserved` are keys the container manages itself (system fields, row `id`, `blockType`).
 */
function validateFields(
  slug: string,
  fields: Record<string, Field>,
  path: string,
  reserved: Set<string>,
  bySlug: Map<string, AnyCollection>,
): void {
  if (path && Object.keys(fields).length === 0) fail(slug, path, `needs at least one field.`);
  for (const [key, field] of Object.entries(fields)) {
    const at = path ? `${path}.${key}` : key;
    if (typeof field !== "object" || field === null || typeof field.type !== "string") {
      fail(slug, at, `not a field: use a field helper such as text().`);
    }
    if (reserved.has(key)) {
      fail(slug, at, `"${key}" is reserved here (${[...reserved].join(", ")}).`);
    }
    if (key.startsWith("_")) {
      fail(slug, at, `field names starting with "_" are reserved.`);
    }
    if (key.includes(".")) {
      fail(slug, at, `field names cannot contain ".".`);
    }

    switch (field.type) {
      case "select": {
        const values = selectOptionValues(field.options);
        if (values.length === 0) fail(slug, at, `select fields need at least one option.`);
        const dup = values.find((v, i) => values.indexOf(v) !== i);
        if (dup !== undefined) fail(slug, at, `duplicate select option value "${dup}".`);
        break;
      }
      case "relation":
      case "media": {
        const target = bySlug.get(field.relationTo);
        if (!target) fail(slug, at, `relationTo "${field.relationTo}" does not match any collection.`);
        if (field.type === "media" && !isUploadCollection(target)) {
          fail(slug, at, `media fields must target an upload collection; "${field.relationTo}" is not one.`);
        }
        break;
      }
      case "date":
        for (const k of ["min", "max"] as const) {
          const v = field[k];
          if (v !== undefined && validateFieldValue({ type: "date", time: field.time } as Field, v)) {
            fail(slug, at, `${k} "${v}" is not a valid ${field.time ? "ISO-8601 date-time" : "YYYY-MM-DD date"}.`);
          }
        }
        break;
      case "url":
        if (field.protocols !== undefined && field.protocols.length === 0) fail(slug, at, `protocols cannot be empty.`);
        break;
      case "json":
        if (field.schema !== undefined && typeof field.schema?.["~standard"]?.validate !== "function") {
          fail(slug, at, `schema must be a Standard Schema (e.g. a Zod schema).`);
        }
        break;
      case "group":
        if ("defaultValue" in field && field.defaultValue !== undefined) fail(slug, at, `groups cannot have a defaultValue; set defaults on their fields.`);
        validateFields(slug, field.fields as Record<string, Field>, at, new Set(), bySlug);
        break;
      case "array":
        validateRows(slug, at, field);
        validateFields(slug, field.fields as Record<string, Field>, at, ROW_KEYS, bySlug);
        break;
      case "blocks": {
        validateRows(slug, at, field);
        if (field.blocks.length === 0) fail(slug, at, `blocks fields need at least one block.`);
        const seen = new Set<string>();
        for (const block of field.blocks) {
          if (typeof block.slug !== "string" || !BLOCK_SLUG_RE.test(block.slug)) {
            fail(slug, at, `invalid block slug "${String(block.slug)}": use letters, digits, "-" and "_", starting with a letter.`);
          }
          if (seen.has(block.slug)) fail(slug, at, `duplicate block slug "${block.slug}".`);
          seen.add(block.slug);
          validateFields(slug, block.fields as Record<string, Field>, `${at}[${block.slug}]`, BLOCK_KEYS, bySlug);
        }
        break;
      }
    }

    if (field.defaultValue !== undefined) {
      const error = validateFieldValue(field, field.defaultValue);
      if (error) fail(slug, at, `invalid defaultValue: ${error}`);
    }
  }
}

function validateCollection(c: AnyCollection, bySlug: Map<string, AnyCollection>): void {
  const slug = c.slug;
  const fields = c.fields as Record<string, Field>;
  const reserved = new Set<string>(RESERVED_KEYS);
  if (isUploadCollection(c)) for (const k of UPLOAD_KEY_SET) reserved.add(k);
  validateFields(slug, fields, "", reserved, bySlug);

  if (c.slugFrom !== undefined) {
    const f = fields[c.slugFrom];
    if (!f || f.type !== "text") {
      fail(slug, null, `slugFrom "${c.slugFrom}" must reference a text field.`);
    }
  }
  if (c.admin?.useAsTitle !== undefined && !(c.admin.useAsTitle in fields)) {
    fail(slug, null, `admin.useAsTitle "${c.admin.useAsTitle}" is not a field.`);
  }
  for (const col of c.admin?.defaultColumns ?? []) {
    if (!(col in fields) && !RESERVED_KEYS.has(col)) {
      fail(slug, null, `admin.defaultColumns entry "${col}" is not a field or system field.`);
    }
  }
}

/**
 * Defines the XenonCMS config. Validates the collection graph eagerly so mistakes
 * surface at boot (or build) time instead of on the first request.
 */
export function defineConfig<const Cs extends readonly AnyCollection[]>(
  config: XenonConfigInput<Cs>,
): XenonConfig<Cs> {
  const bySlug = new Map<string, AnyCollection>();
  for (const c of config.collections) {
    if (typeof c.slug !== "string" || !SLUG_RE.test(c.slug)) {
      throw new XenonConfigError(
        `[xenon] Invalid collection slug "${String(c.slug)}": use lowercase letters, digits and dashes, starting with a letter.`,
      );
    }
    if (RESERVED_COLLECTION_SLUGS.has(c.slug)) {
      throw new XenonConfigError(`[xenon] Collection slug "${c.slug}" is reserved.`);
    }
    if (bySlug.has(c.slug)) {
      throw new XenonConfigError(`[xenon] Duplicate collection slug "${c.slug}".`);
    }
    bySlug.set(c.slug, c);
  }
  for (const c of config.collections) validateCollection(c, bySlug);

  return {
    ...config,
    admin: { path: normalizePath(config.admin?.path ?? "/admin") },
    api: { path: normalizePath(config.api?.path ?? "/api/xenon") },
  };
}

function normalizePath(p: string): string {
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

/** Looks up a collection by slug, or `undefined`. */
export function getCollection<Cfg extends XenonConfig>(
  config: Cfg,
  slug: string,
): Cfg["collections"][number] | undefined {
  return config.collections.find((c) => c.slug === slug);
}
