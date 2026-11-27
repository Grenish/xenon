import type { BetterAuthPlugin } from "better-auth";
import { matchesOperators } from "../adapters/match";
import type { DatabaseAdapter, DocumentRecord, StorageAdapter, Where, WhereOperators } from "../adapters/types";
import { SlugConflictError, UniqueConflictError, UpdateConflictError } from "../adapters/types";
import { createXenonAuth, resolveSecret, resolveUser } from "../auth";
import { mergeUpdate, pruneToFields, withReadDefaults } from "../core/defaults";
import { slugify } from "../core/slug";

export { slugify };
import { XenonError } from "../core/errors";
import { type AnyGlobal, GLOBALS_COLLECTION } from "../core/global";
import type { HookBaseArgs, HookContext, HookOperation } from "../core/hooks";
import type { AnyCollection, Field, XenonConfig, XenonUser } from "../core/types";
import { UPLOAD_KEYS } from "../core/types";
import { type ValidationMode, validateCollectionData } from "../core/validation";
import { createGlobalMethods } from "./globals";
import {
  hasHooks,
  MAX_HOOK_DEPTH,
  runChainHooks,
  runEffectHooks,
  runFieldHooks,
} from "./hooks";
import {
  applySelect,
  extractFieldIndexes,
  populateDocs,
  resolveFieldAtPath,
  validatePopulate,
  validateSelect,
} from "./populate";
import { createSearchInput, searchTextFor, updateSearchInput } from "./search";
import {
  PRESIGN_DEFAULT_EXPIRES_IN,
  type PreparedUpload,
  prepareUpload,
  signPresignToken,
  validatePresignRequest,
  verifyPresignedObject,
  verifyPresignToken,
} from "./uploads";
import type { CallContext, CreateXenonOptions, PresignUploadOutput, UploadFile, XenonAuth, XenonInstance } from "./types";

type AnyDoc = Record<string, unknown>;
type Op = "read" | "create" | "update" | "delete";

/** Internal call option: how many hook-initiated Local API calls deep this call is. */
const HOOK_DEPTH = Symbol("xenon.hookDepth");
type HookCall = CallContext & { [HOOK_DEPTH]?: number };

/** Local API methods that the `xenon` handed to hooks forwards `context` and depth through. */
const SCOPED_METHODS = [
  "find",
  "findById",
  "findBySlug",
  "create",
  "update",
  "unpublish",
  "delete",
  "presignUpload",
  "completeUpload",
] as const;

/** Per-call hook state: one shared `context`, and a lazily built hook-facing `xenon`. */
interface OpScope {
  user: XenonUser | null;
  context: HookContext;
  depth: number;
  readonly xenon: XenonInstance;
}

const isRecord = (v: unknown): v is AnyDoc => typeof v === "object" && v !== null && !Array.isArray(v);

function cloneInput(data: unknown): unknown {
  try {
    return structuredClone(data);
  } catch {
    return data;
  }
}

/** Internal (never returned) storage metadata kept inside `data` of upload documents. */
const FILE_KEY = "_file";

/**
 * Internal slug state kept inside the written data (never returned): `manual` — the slug was set by
 * hand and no longer follows `slugFrom`; `pending` (working copy of a published document only) — a
 * slug change saved as a draft, applied on the next publish (`null` = back to automatic).
 */
const SLUG_KEY = "_slug";
interface SlugMeta { manual?: boolean; pending?: string | null }

function slugMetaOf(source: AnyDoc | null | undefined): SlugMeta {
  const meta = source?.[SLUG_KEY];
  return typeof meta === "object" && meta !== null ? (meta as SlugMeta) : {};
}

function withSlugMeta(data: AnyDoc, meta: SlugMeta): AnyDoc {
  const clean: SlugMeta = {};
  if (meta.manual) clean.manual = true;
  if (meta.pending !== undefined) clean.pending = meta.pending;
  if (Object.keys(clean).length) data[SLUG_KEY] = clean;
  else delete data[SLUG_KEY];
  return data;
}

export interface CreateXenonInternalOptions extends CreateXenonOptions {
  /** Extra BetterAuth plugins (e.g. `nextCookies()` from the Next.js integration). */
  authPlugins?: BetterAuthPlugin[];
}

/** `base`, `base-2`, `base-3`, …: the suffix a slug takes in its collection, or `null` if unrelated. */
function slugSuffix(slug: string, base: string): number | null {
  if (slug === base) return 1;
  if (!slug.startsWith(`${base}-`)) return null;
  const rest = slug.slice(base.length + 1);
  return /^[1-9][0-9]{0,8}$/.test(rest) ? Number(rest) : null;
}

const isUpload = (c: AnyCollection) => c.upload !== undefined && c.upload !== false;
const draftsEnabled = (c: AnyCollection) => c.drafts !== false && !isUpload(c);
const fieldsOf = (c: AnyCollection) => c.fields as Record<string, Field>;

function pickUploadMeta(data: AnyDoc): AnyDoc {
  const out: AnyDoc = {};
  for (const key of UPLOAD_KEYS) if (key in data) out[key] = data[key];
  if (FILE_KEY in data) out[FILE_KEY] = data[FILE_KEY];
  return out;
}

function storageKeyOf(record: DocumentRecord): string | null {
  const file = record.data[FILE_KEY] as { key?: unknown } | undefined;
  return typeof file?.key === "string" ? file.key : null;
}

/** Ever published → slug frozen. Unpublished docs keep their last live data in `data`. */
function wasPublished(record: DocumentRecord): boolean {
  return record.status === "published" || Object.keys(record.data).length > 0;
}

export function createXenon<Cfg extends XenonConfig>(
  config: Cfg,
  options: CreateXenonInternalOptions = {},
): XenonInstance<Cfg> {
  const collections = new Map<string, AnyCollection>(config.collections.map((c) => [c.slug, c]));
  const globals = new Map<string, AnyGlobal>((config.globals ?? []).map((g) => [g.slug, g]));
  let initPromise: Promise<void> | null = null;
  let authPromise: Promise<XenonAuth> | null = null;

  function requireDb(): DatabaseAdapter {
    if (!config.db) throw new Error("[xenon] No database configured: set `db` in defineConfig().");
    return config.db;
  }

  function requireStorage(): StorageAdapter {
    if (!config.storage) throw new Error("[xenon] Upload collections need `storage` in defineConfig().");
    return config.storage;
  }

  function hasPresignedStorage(storage: StorageAdapter | undefined): storage is StorageAdapter & Required<Pick<StorageAdapter, "createPresignedUpload" | "head" | "readRange">> {
    return Boolean(storage?.createPresignedUpload && storage?.head && storage?.readRange);
  }

  function requirePresignedStorage() {
    if (!hasPresignedStorage(config.storage)) {
      throw new XenonError("NOT_IMPLEMENTED", "Configured storage adapter does not support presigned uploads.");
    }
    return config.storage;
  }

  const fieldIndexes = extractFieldIndexes(config.collections);

  async function init(): Promise<void> {
    initPromise ??= (async () => {
      await requireDb().init(fieldIndexes.length ? { indexes: fieldIndexes } : undefined);
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
    return initPromise;
  }

  function requireCollection(slug: string): AnyCollection {
    const c = collections.get(slug);
    if (!c) throw new XenonError("NOT_FOUND", `Unknown collection "${slug}".`);
    return c;
  }

  async function checkAccess(collection: AnyCollection, op: Op, ctx: CallContext, draft = false) {
    if (ctx.overrideAccess !== false) return;
    const user = ctx.user ?? null;
    const fn = collection.access?.[op];
    const allowed = fn ? await fn({ user }) : op === "read" && !draft ? true : user !== null;
    if (allowed && op === "read" && draft && !user) {
      throw new XenonError("UNAUTHORIZED", "Sign in to read drafts.");
    }
    if (!allowed) {
      throw user
        ? new XenonError("FORBIDDEN", `You are not allowed to ${op} "${collection.slug}".`)
        : new XenonError("UNAUTHORIZED", "Authentication required.");
    }
  }

  /** A Local API whose calls carry `context` and count one level deeper (cycle guard for hooks). */
  function scopedXenon(depth: number, context: HookContext): XenonInstance {
    const scoped = Object.create(api) as Record<string, unknown>;
    for (const name of SCOPED_METHODS) {
      const fn = api[name] as unknown as (o: AnyDoc) => unknown;
      scoped[name] = (o: AnyDoc) => fn({ context, ...o, [HOOK_DEPTH]: depth });
    }
    return scoped as unknown as XenonInstance;
  }

  function scopeOf(o: CallContext): OpScope {
    const depth = (o as HookCall)[HOOK_DEPTH] ?? 0;
    if (depth > MAX_HOOK_DEPTH) {
      throw new Error(
        `[xenon] Hooks nested Local API calls more than ${MAX_HOOK_DEPTH} levels deep: a hook is probably re-triggering itself. Use \`context\` to break the cycle.`,
      );
    }
    const context = o.context ?? {};
    let scoped: XenonInstance | undefined;
    return {
      user: o.user ?? null,
      context,
      depth,
      get xenon() {
        scoped ??= scopedXenon(depth + 1, context);
        return scoped;
      },
    };
  }

  function hookBase(collection: AnyCollection, scope: OpScope): HookBaseArgs {
    return { collection, user: scope.user, context: scope.context, xenon: scope.xenon };
  }

  /** Field `afterRead` then collection `afterRead`. */
  async function afterRead(collection: AnyCollection, doc: AnyDoc, draft: boolean, scope: OpScope): Promise<AnyDoc> {
    if (!hasHooks(collection, "afterRead")) return doc;
    const base = hookBase(collection, scope);
    await runFieldHooks("afterRead", collection.fields, { base, data: doc, draft, originalDoc: null });
    return runChainHooks(collection, "afterRead", "doc", doc, { ...base, draft });
  }

  /**
   * `beforeValidate` hooks → validation → `beforeChange` hooks. Returns the data to store
   * (trimmed to the schema when a `beforeChange` hook ran).
   */
  async function prepareWrite(
    collection: AnyCollection,
    scope: OpScope,
    p: { operation: HookOperation; draft: boolean; input: unknown; originalDoc: AnyDoc | null; mode: ValidationMode },
  ): Promise<AnyDoc> {
    let input = p.input;
    const run = { operation: p.operation, draft: p.draft, originalDoc: p.originalDoc };
    if (hasHooks(collection, "beforeValidate") && isRecord(input)) {
      const base = hookBase(collection, scope);
      let data = cloneInput(input) as AnyDoc;
      await runFieldHooks("beforeValidate", collection.fields, { base, data, ...run });
      data = await runChainHooks(collection, "beforeValidate", "data", data, { ...base, ...run });
      input = data;
    }
    let data = validate(collection, input, p.mode);
    if (hasHooks(collection, "beforeChange")) {
      const base = hookBase(collection, scope);
      await runFieldHooks("beforeChange", collection.fields, { base, data, ...run });
      data = await runChainHooks(collection, "beforeChange", "data", data, { ...base, ...run });
      data = pruneToFields(collection.fields, data);
    }
    return data;
  }

  /** After a committed write (and `onChange`): `afterChange` hooks, then `afterRead` on the returned doc. */
  async function finishWrite(
    collection: AnyCollection,
    scope: OpScope,
    record: DocumentRecord,
    p: { operation: HookOperation | "unpublish"; draft: boolean; previousDoc: AnyDoc | null },
  ): Promise<AnyDoc> {
    const doc = toDoc(collection, record, p.draft);
    if (hasHooks(collection, "afterChange")) {
      const base = hookBase(collection, scope);
      const run = { operation: p.operation, draft: p.draft };
      await runFieldHooks("afterChange", collection.fields, { base, data: doc, originalDoc: p.previousDoc, ...run });
      await runEffectHooks(collection, "afterChange", { ...base, ...run, doc, previousDoc: p.previousDoc });
    }
    return afterRead(collection, doc, p.draft, scope);
  }

  /** Working-copy view of `record` for hooks, built only when some write hook will use it. */
  function originalDocFor(collection: AnyCollection, record: DocumentRecord): AnyDoc | null {
    const used = hasHooks(collection, "beforeValidate") || hasHooks(collection, "beforeChange") || hasHooks(collection, "afterChange");
    return used ? toDoc(collection, record, true) : null;
  }

  function toDoc(collection: AnyCollection, record: DocumentRecord, draft: boolean): AnyDoc {
    const source = draft ? (record.draftData ?? record.data) : record.data;
    const fields = withReadDefaults(collection.fields, source);
    const pending = draft && record.draftData ? slugMetaOf(record.draftData).pending : undefined;
    const doc: AnyDoc = {
      id: record.id,
      slug: typeof pending === "string" ? pending : record.slug,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      ...fields,
    };
    if (isUpload(collection)) {
      for (const key of UPLOAD_KEYS) doc[key] = record.data[key] ?? (key === "width" || key === "height" ? null : undefined);
      const storageKey = storageKeyOf(record);
      if (storageKey && config.storage) doc.url = config.storage.getUrl(storageKey);
    }
    return doc;
  }

  function validate(collection: AnyCollection, data: unknown, mode: ValidationMode): AnyDoc {
    const result = validateCollectionData(collection, data, { mode });
    if (!result.success) {
      throw new XenonError("VALIDATION", "The submitted data is invalid.", result.issues);
    }
    return result.data as AnyDoc;
  }

  async function uniqueSlug(collection: AnyCollection, data: AnyDoc, selfId?: string): Promise<string | null> {
    if (!collection.slugFrom) return null;
    const value = data[collection.slugFrom];
    const base = typeof value === "string" ? slugify(value) : "";
    if (!base) return null;
    // One query for every `base` / `base-N` slug in the collection (`contains` over-matches; filtered below).
    const where: Where = { or: [{ slug: { equals: base } }, { slug: { contains: `${base}-` } }] };
    if (selfId) where.id = { not_equals: selfId };
    const { docs } = await requireDb().find({ collection: collection.slug, source: "draft", where, limit: 0 });
    const taken = new Set<number>();
    for (const doc of docs) {
      const n = doc.slug === null ? null : slugSuffix(doc.slug, base);
      if (n !== null) taken.add(n);
    }
    let n = 1;
    while (taken.has(n)) n++;
    return n === 1 ? base : `${base}-${n}`;
  }

  /** A hand-set slug: normalized, and refused when empty or used by another document. */
  async function manualSlug(collection: AnyCollection, input: unknown, selfId?: string): Promise<string> {
    if (typeof input !== "string") {
      throw new XenonError("VALIDATION", "The submitted data is invalid.", [{ path: ["slug"], message: "Expected a string" }]);
    }
    const slug = slugify(input);
    if (!slug) {
      throw new XenonError("VALIDATION", "The submitted data is invalid.", [{ path: ["slug"], message: "Use at least one letter or number" }]);
    }
    const where: Where = { slug: { equals: slug } };
    if (selfId) where.id = { not_equals: selfId };
    const { docs } = await requireDb().find({ collection: collection.slug, source: "draft", where, limit: 1 });
    if (docs.length) {
      const message = `The slug "${slug}" is already used by another document.`;
      throw new XenonError("CONFLICT", message, [{ path: ["slug"], message }]);
    }
    return slug;
  }

  /**
   * Runs a write whose slug was generated by `uniqueSlug`; when a concurrent write claims the same
   * slug first, recomputes it and retries (twice) instead of failing with 409.
   */
  async function withSlugRetry<T>(generated: boolean, nextSlug: () => Promise<string | null>, write: (slug: string | null) => Promise<T>, slug: string | null): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await write(slug);
      } catch (err) {
        if (!generated || attempt >= 2 || !(err instanceof SlugConflictError)) throw err;
        slug = await nextSlug();
      }
    }
  }

  /**
   * Fields with a `defaultValue` read as that default when the stored key is missing or null (see
   * `toDoc`). Rewrites filters on those fields so `where` agrees with what reads return: a missing
   * value matches exactly when the default itself satisfies the operators.
   */
  function withFieldDefaults(collection: AnyCollection, where: Where | undefined): Where | undefined {
    if (!where) return where;
    const fields = fieldsOf(collection);
    const out: Where = {};
    const rewritten: Where[] = [];
    for (const [key, value] of Object.entries(where)) {
      if (value === undefined) continue;
      if (key === "and" || key === "or") {
        out[key] = (value as Where[]).map((part) => withFieldDefaults(collection, part) ?? {});
        continue;
      }
      const field = resolveFieldAtPath(fields, key);
      if (field?.defaultValue === undefined || field.defaultValue === null) {
        out[key] = value;
        continue;
      }
      const ops = value as WhereOperators;
      const stored: Where = { and: [{ [key]: ops }, { [key]: { exists: true } }] };
      rewritten.push(matchesOperators(field.defaultValue, ops) ? { or: [stored, { [key]: { exists: false } }] } : stored);
    }
    if (rewritten.length) out.and = [...(out.and ?? []), ...rewritten];
    return out;
  }

  async function storeFile(collection: AnyCollection, file: UploadFile): Promise<PreparedUpload & { url: string }> {
    const prepared = await prepareUpload(collection, file);
    const { url } = await requireStorage().upload({
      key: prepared.key,
      body: prepared.body,
      contentType: prepared.meta.mimeType,
      size: prepared.meta.filesize,
    });
    return { ...prepared, url };
  }

  async function notify(collection: string, id: string, op: "create" | "update" | "delete" | "unpublish", draft = false) {
    try {
      await options.onChange?.({ collection, id, op, draft });
    } catch (err) {
      console.warn("[xenon] onChange handler failed:", err);
    }
  }

  function staleError(): XenonError {
    const message = "This document was saved by someone else after you opened it.";
    // `updatedAt` in the issue path tells clients "stale version" apart from a slug conflict.
    return new XenonError("CONFLICT", message, [{ path: ["updatedAt"], message }]);
  }

  function expectedVersion(value: string | Date | undefined): Date | undefined {
    if (value === undefined) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new XenonError("BAD_REQUEST", "expectedUpdatedAt must be an ISO date.");
    return date;
  }

  function conflict(err: unknown): never {
    if (err instanceof SlugConflictError) throw new XenonError("CONFLICT", err.message);
    if (err instanceof UniqueConflictError) {
      const message = `The value for "${err.path.join(".")}" is already used by another document.`;
      throw new XenonError("CONFLICT", message, [{ path: [...err.path], message }]);
    }
    if (err instanceof UpdateConflictError) throw staleError();
    throw err;
  }

  async function getRecord(collection: AnyCollection, id: string): Promise<DocumentRecord> {
    const record = await requireDb().findById(collection.slug, id);
    if (!record) throw new XenonError("NOT_FOUND", `Document "${id}" not found in "${collection.slug}".`);
    return record;
  }

  async function prepareReadModifiers(
    collection: AnyCollection,
    o: CallContext & { select?: unknown; populate?: unknown },
    draft: boolean,
  ) {
    const select = o.select !== undefined ? validateSelect(collection, o.select) : undefined;
    const pop = o.populate !== undefined ? validatePopulate(collection, o.populate, (s) => collections.get(s)) : undefined;
    if (pop) {
      for (const target of pop.targets) {
        await checkAccess(target, "read", o, draft);
      }
    }
    return { select, populate: pop?.spec };
  }

  async function finalizeDocs(
    collection: AnyCollection,
    docs: AnyDoc[],
    draft: boolean,
    modifiers: { select?: ReturnType<typeof validateSelect>; populate?: ReturnType<typeof validatePopulate>["spec"] },
    scope: OpScope,
  ): Promise<AnyDoc[]> {
    if (modifiers.populate && docs.length) {
      await populateDocs({
        collection,
        docs,
        spec: modifiers.populate,
        draft,
        db: requireDb(),
        getCollection: (s) => collections.get(s),
        toDoc,
        afterRead: (c, doc) => afterRead(c, doc, draft, scope),
      });
    }
    const read = hasHooks(collection, "afterRead")
      ? await Promise.all(docs.map((d) => afterRead(collection, d, draft, scope)))
      : docs;
    return modifiers.select ? read.map((d) => applySelect(d, modifiers.select!, modifiers.populate, true)) : read;
  }

  async function notifyGlobal(slug: string, id: string, op: "update" | "unpublish", draft = false) {
    try {
      await options.onChange?.({ collection: GLOBALS_COLLECTION, global: slug, id, op, draft });
    } catch (err) {
      console.warn("[xenon] onChange handler failed:", err);
    }
  }

  const globalMethods = createGlobalMethods({
    config,
    globals,
    init,
    requireDb,
    getCollection: (slug) => collections.get(slug),
    checkCollectionReadAccess: (collection, ctx, draft) => checkAccess(collection, "read", ctx, draft),
    toCollectionDoc: toDoc,
    notifyGlobal,
  });

  const api: XenonInstance<XenonConfig> = {
    config,
    init,
    ...globalMethods,

    async find(o) {
      await init();
      const collection = requireCollection(o.collection);
      const scope = scopeOf(o);
      const draft = o.draft === true;
      await checkAccess(collection, "read", o, draft);
      const modifiers = await prepareReadModifiers(collection, o, draft);
      const result = await requireDb().find({
        collection: collection.slug,
        source: draft ? "draft" : "published",
        where: withFieldDefaults(collection, o.where),
        search: o.search,
        sort: o.sort,
        limit: o.limit,
        page: o.page,
      });
      const docs = await finalizeDocs(
        collection,
        result.docs.map((r) => toDoc(collection, r, draft)),
        draft,
        modifiers,
        scope,
      );
      return { ...result, docs } as never;
    },

    async findById(o) {
      await init();
      const collection = requireCollection(o.collection);
      const scope = scopeOf(o);
      const draft = o.draft === true;
      await checkAccess(collection, "read", o, draft);
      const modifiers = await prepareReadModifiers(collection, o, draft);
      const record = await requireDb().findById(collection.slug, o.id);
      if (!record || (!draft && record.status !== "published")) return null;
      const [doc] = await finalizeDocs(collection, [toDoc(collection, record, draft)], draft, modifiers, scope);
      return (doc ?? null) as never;
    },

    async findBySlug(o) {
      const { docs } = await api.find({
        collection: o.collection,
        where: { slug: { equals: o.slug } },
        limit: 1,
        draft: o.draft,
        select: o.select as never,
        populate: o.populate as never,
        user: o.user,
        overrideAccess: o.overrideAccess,
        context: o.context,
        [HOOK_DEPTH]: (o as HookCall)[HOOK_DEPTH],
      } as never);
      return (docs[0] ?? null) as never;
    },

    async create(o) {
      await init();
      const collection = requireCollection(o.collection);
      const scope = scopeOf(o);
      await checkAccess(collection, "create", o);
      const asDraft = draftsEnabled(collection) && o.draft === true;
      const data = await prepareWrite(collection, scope, {
        operation: "create",
        draft: asDraft,
        input: o.data,
        originalDoc: null,
        mode: asDraft ? "draft" : "create",
      });

      let stored: (PreparedUpload & { url: string }) | null = null;
      if (isUpload(collection)) {
        if (!o.file) throw new XenonError("BAD_REQUEST", `A file is required for "${collection.slug}".`);
        stored = await storeFile(collection, o.file);
        Object.assign(data, stored.meta, { url: stored.url, [FILE_KEY]: { key: stored.key } });
      }

      let record: DocumentRecord;
      try {
        const nextSlug = () => uniqueSlug(collection, data);
        const manual = o.slug !== undefined && o.slug !== null;
        const slug = manual ? await manualSlug(collection, o.slug, undefined) : await nextSlug();
        withSlugMeta(data, { manual });
        record = await withSlugRetry(!manual && slug !== null, nextSlug, (slug) => requireDb().create({
          collection: collection.slug,
          slug,
          status: asDraft ? "draft" : "published",
          data: asDraft ? {} : data,
          draftData: asDraft ? data : null,
          ...createSearchInput(collection, data, slug, asDraft),
        }), slug).catch(conflict);
      } catch (err) {
        if (stored) await requireStorage().delete(stored.key).catch(() => {});
        throw err;
      }
      await notify(collection.slug, record.id, "create", asDraft);
      return (await finishWrite(collection, scope, record, { operation: "create", draft: asDraft, previousDoc: null })) as never;
    },

    async update(o) {
      await init();
      const collection = requireCollection(o.collection);
      const scope = scopeOf(o);
      await checkAccess(collection, "update", o);
      const existing = await getRecord(collection, o.id);
      const asDraft = draftsEnabled(collection) && o.draft === true;
      // Fail fast on a stale edit (the row was already read for the merge); the write re-checks atomically.
      const ifUpdatedAt = expectedVersion(o.expectedUpdatedAt);
      if (ifUpdatedAt && existing.updatedAt.getTime() !== ifUpdatedAt.getTime()) throw staleError();

      const working = existing.draftData ?? existing.data;
      if (typeof o.data !== "object" || o.data === null || Array.isArray(o.data)) {
        throw new XenonError("VALIDATION", "The submitted data is invalid.", [
          { path: [], message: "Expected an object" },
        ]);
      }
      // Validate the merged document so required-field rules see the whole picture. Groups merge
      // recursively; stored data is first trimmed to the current schema (fields may have been removed).
      const merged = mergeUpdate(collection.fields, pruneToFields(collection.fields, working), o.data as AnyDoc);
      const originalDoc = originalDocFor(collection, existing);
      const data = await prepareWrite(collection, scope, {
        operation: "update",
        draft: asDraft,
        input: merged,
        originalDoc,
        mode: asDraft ? "draft" : "create",
      });

      let stored: (PreparedUpload & { url: string }) | null = null;
      if (isUpload(collection)) {
        if (o.file) {
          stored = await storeFile(collection, o.file);
          Object.assign(data, stored.meta, { url: stored.url, [FILE_KEY]: { key: stored.key } });
        } else {
          Object.assign(data, pickUploadMeta(existing.data));
        }
      }

      const published = wasPublished(existing);
      const frozen = published && existing.slug !== null;
      const nextSlug = () => uniqueSlug(collection, data, existing.id);
      const before = slugMetaOf(existing.draftData ?? existing.data);
      // A slug change saved as a draft of a published document waits for the next publish.
      let requested = o.slug;
      if (!asDraft && requested === undefined && before.pending !== undefined) requested = before.pending;
      let slug: string | null;
      let generated = false;
      if (asDraft && published && requested !== undefined) {
        const pending = requested === null ? null : await manualSlug(collection, requested, existing.id);
        slug = existing.slug;
        withSlugMeta(data, { manual: before.manual, pending });
      } else if (requested !== undefined && requested !== null) {
        slug = await manualSlug(collection, requested, existing.id);
        withSlugMeta(data, { manual: true });
      } else if (requested === null) {
        // Back to automatic: follows `slugFrom` again (even on a published document — an explicit choice).
        slug = await nextSlug();
        generated = slug !== null;
        withSlugMeta(data, {});
      } else if (before.manual) {
        slug = existing.slug;
        withSlugMeta(data, { manual: true, pending: asDraft ? before.pending : undefined });
      } else {
        slug = frozen ? existing.slug : await nextSlug();
        generated = !frozen && slug !== null;
        withSlugMeta(data, { pending: asDraft ? before.pending : undefined });
      }
      let record: DocumentRecord;
      try {
        const written = await withSlugRetry(generated, nextSlug, (slug) => requireDb().update(
          collection.slug,
          existing.id,
          asDraft
            ? { slug, draftData: data, ...updateSearchInput(collection, data, slug, true) }
            : { slug, data, draftData: null, status: "published", ...updateSearchInput(collection, data, slug, false) },
          ifUpdatedAt ? { ifUpdatedAt } : undefined,
        ), slug).catch(conflict);
        if (!written) throw new XenonError("NOT_FOUND", `Document "${o.id}" not found in "${collection.slug}".`);
        record = written;
      } catch (err) {
        if (stored) await requireStorage().delete(stored.key).catch(() => {});
        throw err;
      }
      if (stored) {
        const oldKey = storageKeyOf(existing);
        if (oldKey) await requireStorage().delete(oldKey).catch(() => {});
      }
      await notify(collection.slug, record.id, "update", asDraft);
      return (await finishWrite(collection, scope, record, { operation: "update", draft: asDraft, previousDoc: originalDoc })) as never;
    },

    async unpublish(o) {
      await init();
      const collection = requireCollection(o.collection);
      const scope = scopeOf(o);
      await checkAccess(collection, "update", o);
      if (!draftsEnabled(collection)) {
        throw new XenonError("BAD_REQUEST", `"${collection.slug}" does not use drafts.`);
      }
      const existing = await getRecord(collection, o.id);
      const previousDoc = originalDocFor(collection, existing);
      const record = await requireDb().update(collection.slug, existing.id, {
        status: "draft",
        draftData: existing.draftData ?? existing.data,
        draftSearchText: searchTextFor(collection, existing.draftData ?? existing.data, existing.slug),
      });
      if (!record) throw new XenonError("NOT_FOUND", `Document "${o.id}" not found in "${collection.slug}".`);
      await notify(collection.slug, record.id, "unpublish");
      return (await finishWrite(collection, scope, record, { operation: "unpublish", draft: true, previousDoc })) as never;
    },

    async delete(o) {
      await init();
      const collection = requireCollection(o.collection);
      const scope = scopeOf(o);
      await checkAccess(collection, "delete", o);
      const existing = await getRecord(collection, o.id);
      const doc = toDoc(collection, existing, true);
      if (hasHooks(collection, "beforeDelete")) {
        await runEffectHooks(collection, "beforeDelete", { ...hookBase(collection, scope), id: existing.id, doc });
      }
      const deleted = await requireDb().delete(collection.slug, existing.id);
      if (!deleted) throw new XenonError("NOT_FOUND", `Document "${o.id}" not found in "${collection.slug}".`);
      const key = storageKeyOf(existing);
      if (key && config.storage) await config.storage.delete(key).catch(() => {});
      await notify(collection.slug, existing.id, "delete");
      if (hasHooks(collection, "afterDelete")) {
        await runEffectHooks(collection, "afterDelete", { ...hookBase(collection, scope), id: existing.id, doc });
      }
      return (await afterRead(collection, doc, true, scope)) as never;
    },

    getCollection: (slug) => collections.get(slug),

    async getAuth() {
      if (!config.db) return null;
      await init();
      // Lazy: content reads (e.g. during `next build`) never need auth or its secret.
      authPromise ??= createXenonAuth(config, config.db, options.authPlugins).catch((err) => {
        authPromise = null;
        throw err;
      });
      return authPromise;
    },

    async getUser(headers: Headers): Promise<XenonUser | null> {
      return resolveUser(config, await api.getAuth(), headers);
    },

    async handleAuthRequest(request: Request) {
      const a = await api.getAuth();
      if (!a) return Response.json({ errors: [{ message: "Auth is not configured." }] }, { status: 404 });
      return a.handler(request);
    },

    async readFile(key: string) {
      return config.storage?.read ? config.storage.read(key) : null;
    },

    get supportsPresignedUploads() {
      return hasPresignedStorage(config.storage);
    },

    async presignUpload(o): Promise<PresignUploadOutput> {
      await init();
      const collection = requireCollection(o.collection);
      if (!isUpload(collection)) {
        throw new XenonError("BAD_REQUEST", `Collection "${collection.slug}" does not support uploads.`);
      }
      const storage = requirePresignedStorage();
      await checkAccess(collection, o.id !== undefined ? "update" : "create", o);

      if (o.id !== undefined) {
        const existing = await getRecord(collection, o.id);
        const ifUpdatedAt = expectedVersion(o.expectedUpdatedAt);
        if (ifUpdatedAt && existing.updatedAt.getTime() !== ifUpdatedAt.getTime()) throw staleError();
      }

      const plan = validatePresignRequest(collection, {
        filename: o.filename,
        mimeType: o.mimeType,
        size: o.size,
      });
      const expiresIn = o.expiresIn ?? PRESIGN_DEFAULT_EXPIRES_IN;
      const presigned = await storage.createPresignedUpload({
        key: plan.key,
        contentType: plan.mimeType,
        size: o.size,
        expiresIn,
      });
      const parsedExp = Date.parse(presigned.expiresAt);
      const exp = Number.isFinite(parsedExp) ? parsedExp : Date.now() + expiresIn * 1000;
      const token = await signPresignToken(resolveSecret(config), {
        collection: collection.slug,
        key: presigned.key,
        filename: plan.filename,
        mimeType: plan.mimeType,
        size: o.size,
        userId: o.user?.id ?? null,
        ...(o.id !== undefined ? { id: o.id } : {}),
        exp,
      });

      return {
        key: presigned.key,
        token,
        upload: {
          url: presigned.url,
          method: presigned.method,
          headers: presigned.headers,
          expiresAt: presigned.expiresAt,
        },
        url: storage.getUrl(presigned.key),
      };
    },

    async completeUpload(o) {
      await init();
      const collection = requireCollection(o.collection);
      const scope = scopeOf(o);
      if (!isUpload(collection)) {
        throw new XenonError("BAD_REQUEST", `Collection "${collection.slug}" does not support uploads.`);
      }
      const storage = requirePresignedStorage();

      const payload = await verifyPresignToken(resolveSecret(config), o.token);
      if (!payload) {
        throw new XenonError("BAD_REQUEST", "Invalid or expired upload token.");
      }
      if (payload.collection !== collection.slug) {
        throw new XenonError("BAD_REQUEST", "Upload token does not match this collection.");
      }
      if (o.key !== undefined && o.key !== payload.key) {
        throw new XenonError("BAD_REQUEST", "Upload key does not match the signed upload token.");
      }

      let targetId: string | undefined;
      if (payload.id !== undefined) {
        if (o.id !== undefined && o.id !== payload.id) {
          throw new XenonError("BAD_REQUEST", "Upload token does not match the target document.");
        }
        targetId = payload.id;
      } else if (o.id !== undefined) {
        throw new XenonError("BAD_REQUEST", "Upload token was not issued for updating a document.");
      }

      await checkAccess(collection, targetId !== undefined ? "update" : "create", o);
      if (o.overrideAccess === false && payload.userId !== (o.user?.id ?? null)) {
        throw new XenonError("FORBIDDEN", "Upload token does not belong to the current user.");
      }

      // Replay guard BEFORE object cleanup: never delete an already-completed document's live object.
      const finalUrl = storage.getUrl(payload.key);
      const completed = await requireDb().find({
        collection: collection.slug,
        source: "published",
        where: { url: { equals: finalUrl } },
        limit: 1,
      });
      if (completed.docs.length > 0) {
        throw new XenonError("CONFLICT", "This upload has already been completed.");
      }

      // Critical #2 guardrail: HEAD + Range GET (magic bytes, active-content block, maxFileSize, image-size).
      // Deletes the object from storage immediately if any check fails.
      const verified = await verifyPresignedObject(
        collection,
        storage,
        payload.key,
        payload.filename,
        payload.mimeType,
      );

      let record: DocumentRecord;
      let previousDoc: AnyDoc | null = null;
      try {
        if (targetId === undefined) {
          const data = await prepareWrite(collection, scope, {
            operation: "create",
            draft: false,
            input: o.data,
            originalDoc: null,
            mode: "create",
          });
          Object.assign(data, verified.meta, { url: verified.url, [FILE_KEY]: { key: verified.key } });
          const nextSlug = () => uniqueSlug(collection, data);
          const slug = await nextSlug();
          record = await withSlugRetry(
            slug !== null,
            nextSlug,
            (s) => requireDb().create({
              collection: collection.slug,
              slug: s,
              status: "published",
              data,
              draftData: null,
              ...createSearchInput(collection, data, s, false),
            }),
            slug,
          ).catch(conflict);
        } else {
          const existing = await getRecord(collection, targetId);
          const ifUpdatedAt = expectedVersion(o.expectedUpdatedAt);
          if (ifUpdatedAt && existing.updatedAt.getTime() !== ifUpdatedAt.getTime()) throw staleError();
          if (typeof o.data !== "object" || o.data === null || Array.isArray(o.data)) {
            throw new XenonError("VALIDATION", "The submitted data is invalid.", [
              { path: [], message: "Expected an object" },
            ]);
          }
          const merged = mergeUpdate(collection.fields, pruneToFields(collection.fields, existing.draftData ?? existing.data), o.data as AnyDoc);
          previousDoc = originalDocFor(collection, existing);
          const data = await prepareWrite(collection, scope, {
            operation: "update",
            draft: false,
            input: merged,
            originalDoc: previousDoc,
            mode: "create",
          });
          Object.assign(data, verified.meta, { url: verified.url, [FILE_KEY]: { key: verified.key } });
          const before = slugMetaOf(existing.draftData ?? existing.data);
          const frozen = (wasPublished(existing) && existing.slug !== null) || before.manual;
          if (before.manual) withSlugMeta(data, { manual: true });
          const nextSlug = () => uniqueSlug(collection, data, existing.id);
          const slug = frozen ? existing.slug : await nextSlug();
          const written = await withSlugRetry(
            !frozen && slug !== null,
            nextSlug,
            (s) => requireDb().update(
              collection.slug,
              existing.id,
              { slug: s, data, draftData: null, status: "published", ...updateSearchInput(collection, data, s, false) },
              ifUpdatedAt ? { ifUpdatedAt } : undefined,
            ),
            slug,
          ).catch(conflict);
          if (!written) throw new XenonError("NOT_FOUND", `Document "${targetId}" not found in "${collection.slug}".`);
          record = written;
          const oldKey = storageKeyOf(existing);
          if (oldKey && oldKey !== verified.key) await storage.delete(oldKey).catch(() => {});
        }
      } catch (err) {
        await storage.delete(verified.key).catch(() => {});
        throw err;
      }
      const operation = targetId === undefined ? "create" : "update";
      await notify(collection.slug, record.id, operation, false);
      return (await finishWrite(collection, scope, record, { operation, draft: false, previousDoc })) as never;
    },
  };

  return api as unknown as XenonInstance<Cfg>;
}
