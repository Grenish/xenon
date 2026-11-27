import type { DatabaseAdapter, DocumentRecord, FieldIndexSpec, FieldIndexType } from "../adapters/types";
import { XenonError } from "../core/errors";
import type { AnyCollection, Field, FieldsMap, RuntimePopulate, RuntimeSelect } from "../core/types";
import { SYSTEM_KEYS, UPLOAD_KEYS } from "../core/types";

type AnyDoc = Record<string, unknown>;

export const MAX_POPULATE_DEPTH = 6;
const MAX_SELECT_DEPTH = 16;
const BATCH_CHUNK_SIZE = 1000;

const SYSTEM_KEY_SET = new Set<string>(SYSTEM_KEYS);
const UPLOAD_KEY_SET = new Set<string>(UPLOAD_KEYS);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isUpload = (c: AnyCollection) => c.upload !== undefined && c.upload !== false;

function indexTypeForField(field: Field): FieldIndexType | null {
  switch (field.type) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "text":
    case "select":
    case "date":
    case "email":
    case "url":
    case "media":
    case "relation":
      return "text";
    default:
      return null;
  }
}

function collectFieldIndexes(collectionSlug: string, fields: FieldsMap, prefix: readonly string[], out: FieldIndexSpec[]) {
  for (const [key, field] of Object.entries(fields as Record<string, Field>)) {
    const path = [...prefix, key];
    if (field.type === "group") {
      collectFieldIndexes(collectionSlug, field.fields, path, out);
      continue;
    }
    const indexable = field as { index?: boolean; unique?: boolean; hasMany?: boolean };
    if ((indexable.index === true || indexable.unique === true) && indexable.hasMany !== true) {
      const type = indexTypeForField(field);
      if (type) {
        out.push({
          collection: collectionSlug,
          path,
          type,
          unique: indexable.unique === true,
        });
      }
    }
  }
}

/** Extracts opt-in JSONB expression and unique index specs from all collections in a config. */
export function extractFieldIndexes(collections: readonly AnyCollection[]): FieldIndexSpec[] {
  const out: FieldIndexSpec[] = [];
  for (const c of collections) {
    collectFieldIndexes(c.slug, c.fields, [], out);
  }
  return out;
}

/** Resolves a field definition at a top-level or dot-separated `group` path (e.g. `"seo.noIndex"`). */
export function resolveFieldAtPath(fields: FieldsMap, key: string): Field | undefined {
  const map = fields as Record<string, Field>;
  if (!key.includes(".")) return Object.hasOwn(map, key) ? map[key] : undefined;
  const parts = key.split(".");
  let current = map;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (!seg || !Object.hasOwn(current, seg)) return undefined;
    const field = current[seg]!;
    if (i === parts.length - 1) return field;
    if (field.type !== "group") return undefined;
    current = field.fields as Record<string, Field>;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/*                                   Select                                   */
/* -------------------------------------------------------------------------- */

function validateSelectFields(
  fields: FieldsMap,
  select: Record<string, unknown>,
  prefix: string,
  isRoot: boolean,
  hasUpload: boolean,
  depth: number,
): void {
  if (depth > MAX_SELECT_DEPTH) {
    throw new XenonError("BAD_REQUEST", "select exceeds maximum nesting depth.");
  }
  const map = fields as Record<string, Field>;
  for (const [key, val] of Object.entries(select)) {
    if (val === undefined) continue;
    const at = prefix ? `${prefix}.${key}` : key;
    if (isRoot && (SYSTEM_KEY_SET.has(key) || (hasUpload && UPLOAD_KEY_SET.has(key)))) {
      if (val !== true) throw new XenonError("BAD_REQUEST", `select.${at} must be true.`);
      continue;
    }
    if (!Object.hasOwn(map, key)) {
      throw new XenonError("BAD_REQUEST", `Unknown select field "${at}".`);
    }
    const field = map[key]!;
    if (val === true) continue;
    if (isPlainObject(val)) {
      if (field.type !== "group") {
        throw new XenonError("BAD_REQUEST", `Cannot nest select under "${field.type}" field "${at}".`);
      }
      validateSelectFields(field.fields, val, at, false, false, depth + 1);
      continue;
    }
    throw new XenonError("BAD_REQUEST", `select.${at} must be true.`);
  }
}

export function validateSelect(collection: AnyCollection, select: unknown): RuntimeSelect {
  if (!isPlainObject(select)) {
    throw new XenonError("BAD_REQUEST", "select must be an object.");
  }
  validateSelectFields(collection.fields, select, "", true, isUpload(collection), 0);
  return select as RuntimeSelect;
}

/**
 * Projects a document to the requested `select` keys (always preserving root `id` and any keys
 * explicitly requested via `populate`).
 */
export function applySelect(
  doc: AnyDoc,
  select: RuntimeSelect,
  populate?: RuntimePopulate,
  isRoot = true,
): AnyDoc {
  const out: AnyDoc = {};
  if (isRoot && Object.hasOwn(doc, "id")) out.id = doc.id;
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(select)) if (v !== undefined) keys.add(k);
  if (populate) {
    for (const [k, v] of Object.entries(populate)) if (v !== undefined) keys.add(k);
  }
  for (const key of keys) {
    if (!Object.hasOwn(doc, key)) continue;
    const selVal = Object.hasOwn(select, key) ? select[key] : undefined;
    const popVal = populate && Object.hasOwn(populate, key) ? populate[key] : undefined;
    if (selVal === true) {
      out[key] = doc[key];
    } else if (isPlainObject(selVal)) {
      const value = doc[key];
      out[key] = isPlainObject(value)
        ? applySelect(value, selVal as RuntimeSelect, isPlainObject(popVal) ? (popVal as RuntimePopulate) : undefined, false)
        : value;
    } else if (popVal !== undefined) {
      out[key] = doc[key];
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                  Populate                                  */
/* -------------------------------------------------------------------------- */

function validatePopulateFields(
  fields: FieldsMap,
  spec: Record<string, unknown>,
  prefix: string,
  depth: number,
  getCollection: (slug: string) => AnyCollection | undefined,
  targets: Set<AnyCollection>,
): void {
  if (depth > MAX_POPULATE_DEPTH) {
    throw new XenonError("BAD_REQUEST", `populate exceeds maximum depth (${MAX_POPULATE_DEPTH}).`);
  }
  const map = fields as Record<string, Field>;
  for (const [key, val] of Object.entries(spec)) {
    if (val === undefined) continue;
    const at = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(map, key)) {
      throw new XenonError("BAD_REQUEST", `Unknown populate field "${at}".`);
    }
    const field = map[key]!;
    if (field.type === "relation" || field.type === "media") {
      if (depth >= MAX_POPULATE_DEPTH) {
        throw new XenonError("BAD_REQUEST", `populate exceeds maximum depth (${MAX_POPULATE_DEPTH}).`);
      }
      const target = getCollection(field.relationTo);
      if (!target) {
        throw new XenonError("BAD_REQUEST", `Unknown target collection "${field.relationTo}" on "${at}".`);
      }
      targets.add(target);
      if (val === true) continue;
      if (!isPlainObject(val)) {
        throw new XenonError("BAD_REQUEST", `populate.${at} must be true or an options object.`);
      }
      for (const optKey of Object.keys(val)) {
        if (optKey !== "populate" && optKey !== "select") {
          throw new XenonError(
            "BAD_REQUEST",
            `Unknown populate option "${optKey}" on "${at}" (use "populate" or "select").`,
          );
        }
      }
      if (val.select !== undefined) {
        validateSelect(target, val.select);
      }
      if (val.populate !== undefined) {
        if (!isPlainObject(val.populate)) {
          throw new XenonError("BAD_REQUEST", `populate.${at}.populate must be an object.`);
        }
        validatePopulateFields(target.fields, val.populate, at, depth + 1, getCollection, targets);
      }
      continue;
    }
    if (field.type === "group" || field.type === "array") {
      if (!isPlainObject(val)) {
        throw new XenonError("BAD_REQUEST", `populate.${at} must be an object mapping nested fields.`);
      }
      validatePopulateFields(field.fields, val, at, depth, getCollection, targets);
      continue;
    }
    if (field.type === "blocks") {
      if (!isPlainObject(val)) {
        throw new XenonError("BAD_REQUEST", `populate.${at} must be an object keyed by block slug.`);
      }
      const bySlug = new Map(field.blocks.map((b) => [b.slug, b] as const));
      for (const [blockSlug, blockSpec] of Object.entries(val)) {
        if (blockSpec === undefined) continue;
        const block = bySlug.get(blockSlug);
        if (!block) {
          throw new XenonError("BAD_REQUEST", `Unknown block "${blockSlug}" in populate.${at}.`);
        }
        if (!isPlainObject(blockSpec)) {
          throw new XenonError("BAD_REQUEST", `populate.${at}.${blockSlug} must be an object mapping block fields.`);
        }
        validatePopulateFields(block.fields, blockSpec, `${at}.${blockSlug}`, depth, getCollection, targets);
      }
      continue;
    }
    throw new XenonError("BAD_REQUEST", `Field "${at}" (${field.type}) cannot be populated.`);
  }
}

/** Validates a populate tree and returns every target collection it references (for access checks). */
export function validatePopulate(
  collection: AnyCollection,
  populate: unknown,
  getCollection: (slug: string) => AnyCollection | undefined,
): { spec: RuntimePopulate; targets: Set<AnyCollection> } {
  if (!isPlainObject(populate)) {
    throw new XenonError("BAD_REQUEST", "populate must be an object.");
  }
  const targets = new Set<AnyCollection>();
  validatePopulateFields(collection.fields, populate, "", 0, getCollection, targets);
  return { spec: populate as RuntimePopulate, targets };
}

/** True when any target collection referenced in `populate` defines a custom `access.read` policy. */
export function populatesRestrictedCollection(
  collection: AnyCollection,
  populate: unknown,
  getCollection: (slug: string) => AnyCollection | undefined,
): boolean {
  if (!populate || !isPlainObject(populate)) return false;
  const targets = new Set<AnyCollection>();
  try {
    validatePopulateFields(collection.fields, populate, "", 0, getCollection, targets);
  } catch {
    // Validation errors will be surfaced by xenon.find/findById; conservatively treat as non-public.
    return true;
  }
  for (const target of targets) {
    if (target.access?.read) return true;
  }
  return false;
}

interface PopulateGroup {
  fields: FieldsMap;
  items: AnyDoc[];
  spec: RuntimePopulate;
}

interface DeferredSelect {
  parent: AnyDoc;
  key: string;
  isMany: boolean;
  select: RuntimeSelect;
  populate?: RuntimePopulate;
}

function collectIdsFromContainers(
  fields: FieldsMap,
  items: AnyDoc[],
  spec: RuntimePopulate,
  recordCache: Map<string, Map<string, DocumentRecord | null>>,
  needed: Map<string, Set<string>>,
): void {
  const map = fields as Record<string, Field>;
  for (const [key, entry] of Object.entries(spec)) {
    if (entry === undefined) continue;
    const field = map[key];
    if (!field) continue;

    if (field.type === "relation" || field.type === "media") {
      const targetSlug = field.relationTo;
      const cached = recordCache.get(targetSlug);
      let bucket = needed.get(targetSlug);
      for (const item of items) {
        const value = item[key];
        if (field.hasMany) {
          if (!Array.isArray(value)) continue;
          for (const rawId of value) {
            if (typeof rawId === "string" && !cached?.has(rawId)) {
              if (!bucket) {
                bucket = new Set();
                needed.set(targetSlug, bucket);
              }
              bucket.add(rawId);
            }
          }
        } else if (typeof value === "string" && !cached?.has(value)) {
          if (!bucket) {
            bucket = new Set();
            needed.set(targetSlug, bucket);
          }
          bucket.add(value);
        }
      }
      continue;
    }

    if (field.type === "group" && isPlainObject(entry)) {
      const nested: AnyDoc[] = [];
      for (const item of items) {
        if (isPlainObject(item[key])) nested.push(item[key] as AnyDoc);
      }
      if (nested.length) collectIdsFromContainers(field.fields, nested, entry as RuntimePopulate, recordCache, needed);
      continue;
    }

    if (field.type === "array" && isPlainObject(entry)) {
      const rows: AnyDoc[] = [];
      for (const item of items) {
        if (!Array.isArray(item[key])) continue;
        for (const row of item[key] as unknown[]) {
          if (isPlainObject(row)) rows.push(row);
        }
      }
      if (rows.length) collectIdsFromContainers(field.fields, rows, entry as RuntimePopulate, recordCache, needed);
      continue;
    }

    if (field.type === "blocks" && isPlainObject(entry)) {
      const bySlug = new Map(field.blocks.map((b) => [b.slug, b] as const));
      const rowsByBlock = new Map<string, AnyDoc[]>();
      for (const item of items) {
        if (!Array.isArray(item[key])) continue;
        for (const row of item[key] as unknown[]) {
          if (!isPlainObject(row) || typeof row.blockType !== "string") continue;
          if (!Object.hasOwn(entry, row.blockType)) continue;
          let list = rowsByBlock.get(row.blockType);
          if (!list) {
            list = [];
            rowsByBlock.set(row.blockType, list);
          }
          list.push(row);
        }
      }
      for (const [blockSlug, blockRows] of rowsByBlock) {
        const block = bySlug.get(blockSlug);
        const blockSpec = (entry as Record<string, unknown>)[blockSlug];
        if (block && isPlainObject(blockSpec)) {
          collectIdsFromContainers(block.fields, blockRows, blockSpec as RuntimePopulate, recordCache, needed);
        }
      }
    }
  }
}

function applyResolvedToContainers(
  fields: FieldsMap,
  items: AnyDoc[],
  spec: RuntimePopulate,
  recordCache: Map<string, Map<string, DocumentRecord | null>>,
  getCollection: (slug: string) => AnyCollection | undefined,
  toDoc: (collection: AnyCollection, record: DocumentRecord, draft: boolean) => AnyDoc,
  draft: boolean,
  nextLevel: PopulateGroup[],
  deferredSelects: DeferredSelect[],
): void {
  const map = fields as Record<string, Field>;
  for (const [key, entry] of Object.entries(spec)) {
    if (entry === undefined) continue;
    const field = map[key];
    if (!field) continue;

    if (field.type === "relation" || field.type === "media") {
      const target = getCollection(field.relationTo);
      if (!target) continue;
      const cache = recordCache.get(target.slug);
      const subPopulate = isPlainObject(entry) && isPlainObject(entry.populate)
        ? (entry.populate as RuntimePopulate)
        : undefined;
      const subSelect = isPlainObject(entry) && isPlainObject(entry.select)
        ? (entry.select as RuntimeSelect)
        : undefined;
      const populatedTargets: AnyDoc[] = [];

      for (const item of items) {
        const value = item[key];
        if (field.hasMany) {
          if (!Array.isArray(value)) continue;
          const resolved: AnyDoc[] = [];
          for (const rawId of value) {
            if (typeof rawId !== "string") continue;
            const rec = cache?.get(rawId);
            if (!rec) continue;
            const doc = toDoc(target, rec, draft);
            resolved.push(doc);
            populatedTargets.push(doc);
          }
          item[key] = resolved;
          if (subSelect) {
            deferredSelects.push({ parent: item, key, isMany: true, select: subSelect, populate: subPopulate });
          }
        } else if (typeof value === "string") {
          const rec = cache?.get(value);
          const doc = rec ? toDoc(target, rec, draft) : null;
          item[key] = doc;
          if (doc) {
            populatedTargets.push(doc);
            if (subSelect) {
              deferredSelects.push({ parent: item, key, isMany: false, select: subSelect, populate: subPopulate });
            }
          }
        }
      }

      if (subPopulate && populatedTargets.length) {
        nextLevel.push({ fields: target.fields, items: populatedTargets, spec: subPopulate });
      }
      continue;
    }

    if (field.type === "group" && isPlainObject(entry)) {
      const nested: AnyDoc[] = [];
      for (const item of items) {
        if (isPlainObject(item[key])) nested.push(item[key] as AnyDoc);
      }
      if (nested.length) {
        applyResolvedToContainers(
          field.fields,
          nested,
          entry as RuntimePopulate,
          recordCache,
          getCollection,
          toDoc,
          draft,
          nextLevel,
          deferredSelects,
        );
      }
      continue;
    }

    if (field.type === "array" && isPlainObject(entry)) {
      const rows: AnyDoc[] = [];
      for (const item of items) {
        if (!Array.isArray(item[key])) continue;
        for (const row of item[key] as unknown[]) {
          if (isPlainObject(row)) rows.push(row);
        }
      }
      if (rows.length) {
        applyResolvedToContainers(
          field.fields,
          rows,
          entry as RuntimePopulate,
          recordCache,
          getCollection,
          toDoc,
          draft,
          nextLevel,
          deferredSelects,
        );
      }
      continue;
    }

    if (field.type === "blocks" && isPlainObject(entry)) {
      const bySlug = new Map(field.blocks.map((b) => [b.slug, b] as const));
      const rowsByBlock = new Map<string, AnyDoc[]>();
      for (const item of items) {
        if (!Array.isArray(item[key])) continue;
        for (const row of item[key] as unknown[]) {
          if (!isPlainObject(row) || typeof row.blockType !== "string") continue;
          if (!Object.hasOwn(entry, row.blockType)) continue;
          let list = rowsByBlock.get(row.blockType);
          if (!list) {
            list = [];
            rowsByBlock.set(row.blockType, list);
          }
          list.push(row);
        }
      }
      for (const [blockSlug, blockRows] of rowsByBlock) {
        const block = bySlug.get(blockSlug);
        const blockSpec = (entry as Record<string, unknown>)[blockSlug];
        if (block && isPlainObject(blockSpec)) {
          applyResolvedToContainers(
            block.fields,
            blockRows,
            blockSpec as RuntimePopulate,
            recordCache,
            getCollection,
            toDoc,
            draft,
            nextLevel,
            deferredSelects,
          );
        }
      }
    }
  }
}

/**
 * Resolves an explicit `populate` tree in breadth-first batches: at most one database query per
 * target collection per depth level (zero N+1), reusing already-fetched records across levels.
 */
export async function populateDocs(args: {
  collection: AnyCollection;
  docs: AnyDoc[];
  spec: RuntimePopulate;
  draft: boolean;
  db: DatabaseAdapter;
  getCollection: (slug: string) => AnyCollection | undefined;
  toDoc: (collection: AnyCollection, record: DocumentRecord, draft: boolean) => AnyDoc;
}): Promise<void> {
  if (!args.docs.length) return;
  const recordCache = new Map<string, Map<string, DocumentRecord | null>>();
  const source = args.draft ? "draft" : "published";

  async function processLevel(groups: PopulateGroup[]): Promise<void> {
    const needed = new Map<string, Set<string>>();
    for (const group of groups) {
      collectIdsFromContainers(group.fields, group.items, group.spec, recordCache, needed);
    }

    if (needed.size > 0) {
      await Promise.all(
        [...needed.entries()].map(async ([targetSlug, idSet]) => {
          let cache = recordCache.get(targetSlug);
          if (!cache) {
            cache = new Map();
            recordCache.set(targetSlug, cache);
          }
          const ids = [...idSet];
          for (const id of ids) cache.set(id, null);
          for (let offset = 0; offset < ids.length; offset += BATCH_CHUNK_SIZE) {
            const chunk = ids.slice(offset, offset + BATCH_CHUNK_SIZE);
            const { docs } = await args.db.find({
              collection: targetSlug,
              source,
              where: { id: { in: chunk } },
              limit: 0,
            });
            for (const rec of docs) cache.set(rec.id, rec);
          }
        }),
      );
    }

    const nextLevel: PopulateGroup[] = [];
    const deferredSelects: DeferredSelect[] = [];
    for (const group of groups) {
      applyResolvedToContainers(
        group.fields,
        group.items,
        group.spec,
        recordCache,
        args.getCollection,
        args.toDoc,
        args.draft,
        nextLevel,
        deferredSelects,
      );
    }

    if (nextLevel.length) {
      await processLevel(nextLevel);
    }

    for (const deferred of deferredSelects) {
      const value = deferred.parent[deferred.key];
      if (deferred.isMany && Array.isArray(value)) {
        deferred.parent[deferred.key] = (value as AnyDoc[]).map((d) =>
          applySelect(d, deferred.select, deferred.populate, true),
        );
      } else if (isPlainObject(value)) {
        deferred.parent[deferred.key] = applySelect(value, deferred.select, deferred.populate, true);
      }
    }
  }

  await processLevel([{ fields: args.collection.fields, items: args.docs, spec: args.spec }]);
}
