import type { AnyCollection, Field, XenonConfig, XenonConfigInput } from "./types";
import { SYSTEM_KEYS, UPLOAD_KEYS } from "./types";
import { selectOptionValues, validateFieldValue } from "./validation";

export class XenonConfigError extends Error {
  override name = "XenonConfigError";
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const RESERVED_KEYS = new Set<string>(SYSTEM_KEYS);
const UPLOAD_KEY_SET = new Set<string>(UPLOAD_KEYS);

function fail(collection: string, path: string | null, message: string): never {
  const where = path ? `collection "${collection}" → field "${path}"` : `collection "${collection}"`;
  throw new XenonConfigError(`[xenon] Invalid config in ${where}: ${message}`);
}

function isUploadCollection(c: AnyCollection): boolean {
  return c.upload !== undefined && c.upload !== false;
}

function validateCollection(c: AnyCollection, bySlug: Map<string, AnyCollection>): void {
  const slug = c.slug;
  const fields = c.fields as Record<string, Field>;
  const keys = Object.keys(fields);
  const upload = isUploadCollection(c);

  for (const key of keys) {
    const field = fields[key]!;
    if (RESERVED_KEYS.has(key)) {
      fail(slug, key, `"${key}" is a reserved system field name (${SYSTEM_KEYS.join(", ")}).`);
    }
    if (key.startsWith("_")) {
      fail(slug, key, `field names starting with "_" are reserved.`);
    }
    if (upload && UPLOAD_KEY_SET.has(key)) {
      fail(slug, key, `"${key}" collides with a managed upload field (${UPLOAD_KEYS.join(", ")}).`);
    }

    if (field.type === "select") {
      const values = selectOptionValues(field.options);
      if (values.length === 0) fail(slug, key, `select fields need at least one option.`);
      const dup = values.find((v, i) => values.indexOf(v) !== i);
      if (dup !== undefined) fail(slug, key, `duplicate select option value "${dup}".`);
    }

    if (field.type === "relation" || field.type === "media") {
      const target = bySlug.get(field.relationTo);
      if (!target) {
        fail(slug, key, `relationTo "${field.relationTo}" does not match any collection.`);
      }
      if (field.type === "media" && !isUploadCollection(target)) {
        fail(slug, key, `media fields must target an upload collection; "${field.relationTo}" is not one.`);
      }
    }

    if (field.defaultValue !== undefined) {
      const error = validateFieldValue(field, field.defaultValue);
      if (error) fail(slug, key, `invalid defaultValue: ${error}`);
    }
  }

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
