import type { BetterAuthPlugin } from "better-auth";
import { matchesOperators } from "../adapters/match";
import type { DatabaseAdapter, DocumentRecord, StorageAdapter, Where, WhereOperators } from "../adapters/types";
import { SlugConflictError, UpdateConflictError } from "../adapters/types";
import { createXenonAuth, resolveUser } from "../auth";
import { mergeUpdate, pruneToFields, withReadDefaults } from "../core/defaults";
import { XenonError } from "../core/errors";
import type { AnyCollection, Field, XenonConfig, XenonUser } from "../core/types";
import { UPLOAD_KEYS } from "../core/types";
import { type ValidationMode, validateCollectionData } from "../core/validation";
import { type PreparedUpload, prepareUpload } from "./uploads";
import type { CallContext, CreateXenonOptions, UploadFile, XenonAuth, XenonInstance } from "./types";

type AnyDoc = Record<string, unknown>;
type Op = "read" | "create" | "update" | "delete";

/** Internal (never returned) storage metadata kept inside `data` of upload documents. */
const FILE_KEY = "_file";

export interface CreateXenonInternalOptions extends CreateXenonOptions {
  /** Extra BetterAuth plugins (e.g. `nextCookies()` from the Next.js integration). */
  authPlugins?: BetterAuthPlugin[];
}

/**
 * URL-safe slug. Latin diacritics are folded to ASCII (`Café` → `cafe`); letters and digits of other
 * scripts are kept (`日本語のタイトル` → `日本語のタイトル`) rather than dropped, so non-Latin titles
 * still get a slug. Capped at 96 code points.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // Recompose what the strip left decomposed (e.g. Japanese voiced kana) before matching.
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return Array.from(slug).slice(0, 96).join("").replace(/-+$/g, "");
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

  async function init(): Promise<void> {
    initPromise ??= (async () => {
      await requireDb().init();
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

  function toDoc(collection: AnyCollection, record: DocumentRecord, draft: boolean): AnyDoc {
    const source = draft ? (record.draftData ?? record.data) : record.data;
    const fields = withReadDefaults(collection.fields, source);
    const doc: AnyDoc = {
      id: record.id,
      slug: record.slug,
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
      const field = Object.hasOwn(fields, key) ? fields[key] : undefined;
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
    if (err instanceof UpdateConflictError) throw staleError();
    throw err;
  }

  async function getRecord(collection: AnyCollection, id: string): Promise<DocumentRecord> {
    const record = await requireDb().findById(collection.slug, id);
    if (!record) throw new XenonError("NOT_FOUND", `Document "${id}" not found in "${collection.slug}".`);
    return record;
  }

  const api: XenonInstance<XenonConfig> = {
    config,
    init,

    async find(o) {
      await init();
      const collection = requireCollection(o.collection);
      const draft = o.draft === true;
      await checkAccess(collection, "read", o, draft);
      const result = await requireDb().find({
        collection: collection.slug,
        source: draft ? "draft" : "published",
        where: withFieldDefaults(collection, o.where),
        sort: o.sort,
        limit: o.limit,
        page: o.page,
      });
      return { ...result, docs: result.docs.map((r) => toDoc(collection, r, draft)) } as never;
    },

    async findById(o) {
      await init();
      const collection = requireCollection(o.collection);
      const draft = o.draft === true;
      await checkAccess(collection, "read", o, draft);
      const record = await requireDb().findById(collection.slug, o.id);
      if (!record || (!draft && record.status !== "published")) return null;
      return toDoc(collection, record, draft) as never;
    },

    async findBySlug(o) {
      const { docs } = await api.find({
        collection: o.collection,
        where: { slug: { equals: o.slug } },
        limit: 1,
        draft: o.draft,
        user: o.user,
        overrideAccess: o.overrideAccess,
      });
      return (docs[0] ?? null) as never;
    },

    async create(o) {
      await init();
      const collection = requireCollection(o.collection);
      await checkAccess(collection, "create", o);
      const asDraft = draftsEnabled(collection) && o.draft === true;
      const data = validate(collection, o.data, asDraft ? "draft" : "create");

      let stored: (PreparedUpload & { url: string }) | null = null;
      if (isUpload(collection)) {
        if (!o.file) throw new XenonError("BAD_REQUEST", `A file is required for "${collection.slug}".`);
        stored = await storeFile(collection, o.file);
        Object.assign(data, stored.meta, { url: stored.url, [FILE_KEY]: { key: stored.key } });
      }

      try {
        const nextSlug = () => uniqueSlug(collection, data);
        const slug = await nextSlug();
        const record = await withSlugRetry(slug !== null, nextSlug, (slug) => requireDb().create({
          collection: collection.slug,
          slug,
          status: asDraft ? "draft" : "published",
          data: asDraft ? {} : data,
          draftData: asDraft ? data : null,
        }), slug).catch(conflict);
        await notify(collection.slug, record.id, "create", asDraft);
        return toDoc(collection, record, asDraft) as never;
      } catch (err) {
        if (stored) await requireStorage().delete(stored.key).catch(() => {});
        throw err;
      }
    },

    async update(o) {
      await init();
      const collection = requireCollection(o.collection);
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
      const data = validate(collection, merged, asDraft ? "draft" : "create");

      let stored: (PreparedUpload & { url: string }) | null = null;
      if (isUpload(collection)) {
        if (o.file) {
          stored = await storeFile(collection, o.file);
          Object.assign(data, stored.meta, { url: stored.url, [FILE_KEY]: { key: stored.key } });
        } else {
          Object.assign(data, pickUploadMeta(existing.data));
        }
      }

      const frozen = wasPublished(existing) && existing.slug !== null;
      const nextSlug = () => uniqueSlug(collection, data, existing.id);
      const slug = frozen ? existing.slug : await nextSlug();
      try {
        const record = await withSlugRetry(!frozen && slug !== null, nextSlug, (slug) => requireDb().update(
          collection.slug,
          existing.id,
          asDraft
            ? { slug, draftData: data }
            : { slug, data, draftData: null, status: "published" },
          ifUpdatedAt ? { ifUpdatedAt } : undefined,
        ), slug).catch(conflict);
        if (!record) throw new XenonError("NOT_FOUND", `Document "${o.id}" not found in "${collection.slug}".`);
        if (stored) {
          const oldKey = storageKeyOf(existing);
          if (oldKey) await requireStorage().delete(oldKey).catch(() => {});
        }
        await notify(collection.slug, record.id, "update", asDraft);
        return toDoc(collection, record, asDraft) as never;
      } catch (err) {
        if (stored) await requireStorage().delete(stored.key).catch(() => {});
        throw err;
      }
    },

    async unpublish(o) {
      await init();
      const collection = requireCollection(o.collection);
      await checkAccess(collection, "update", o);
      if (!draftsEnabled(collection)) {
        throw new XenonError("BAD_REQUEST", `"${collection.slug}" does not use drafts.`);
      }
      const existing = await getRecord(collection, o.id);
      const record = await requireDb().update(collection.slug, existing.id, {
        status: "draft",
        draftData: existing.draftData ?? existing.data,
      });
      if (!record) throw new XenonError("NOT_FOUND", `Document "${o.id}" not found in "${collection.slug}".`);
      await notify(collection.slug, record.id, "unpublish");
      return toDoc(collection, record, true) as never;
    },

    async delete(o) {
      await init();
      const collection = requireCollection(o.collection);
      await checkAccess(collection, "delete", o);
      const existing = await getRecord(collection, o.id);
      const deleted = await requireDb().delete(collection.slug, existing.id);
      if (!deleted) throw new XenonError("NOT_FOUND", `Document "${o.id}" not found in "${collection.slug}".`);
      const key = storageKeyOf(existing);
      if (key && config.storage) await config.storage.delete(key).catch(() => {});
      await notify(collection.slug, existing.id, "delete");
      return toDoc(collection, existing, true) as never;
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
  };

  return api as unknown as XenonInstance<Cfg>;
}
