import type { BetterAuthPlugin } from "better-auth";
import type { DatabaseAdapter, DocumentRecord, StorageAdapter, Where } from "../adapters/types";
import { SlugConflictError } from "../adapters/types";
import { createXenonAuth, resolveUser } from "../auth";
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

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
}

const isUpload = (c: AnyCollection) => c.upload !== undefined && c.upload !== false;
const draftsEnabled = (c: AnyCollection) => c.drafts !== false && !isUpload(c);
const fieldsOf = (c: AnyCollection) => c.fields as Record<string, Field>;

function cloneValue<T>(v: T): T {
  return typeof v === "object" && v !== null ? structuredClone(v) : v;
}

/** Keeps only declared fields (drops keys of removed fields and internal metadata). */
function pickFields(collection: AnyCollection, data: AnyDoc): AnyDoc {
  const out: AnyDoc = {};
  for (const key of Object.keys(fieldsOf(collection))) if (key in data) out[key] = data[key];
  return out;
}

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
    const fields = pickFields(collection, source);
    for (const [key, field] of Object.entries(fieldsOf(collection))) {
      if (field.defaultValue !== undefined && (fields[key] === undefined || fields[key] === null)) {
        fields[key] = cloneValue(field.defaultValue);
      }
    }
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
    const db = requireDb();
    for (let n = 1; n <= 50; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      const where: Where = { slug: { equals: candidate } };
      if (selfId) where.id = { not_equals: selfId };
      const { totalDocs } = await db.find({ collection: collection.slug, source: "draft", where, limit: 1 });
      if (totalDocs === 0) return candidate;
    }
    return `${base}-${crypto.randomUUID().slice(0, 8)}`;
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

  async function notify(collection: string, id: string, op: "create" | "update" | "delete" | "unpublish") {
    try {
      await options.onChange?.({ collection, id, op });
    } catch (err) {
      console.warn("[xenon] onChange handler failed:", err);
    }
  }

  function conflict(err: unknown): never {
    if (err instanceof SlugConflictError) throw new XenonError("CONFLICT", err.message);
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
        where: o.where,
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
        const record = await requireDb()
          .create({
            collection: collection.slug,
            slug: await uniqueSlug(collection, data),
            status: asDraft ? "draft" : "published",
            data: asDraft ? {} : data,
            draftData: asDraft ? data : null,
          })
          .catch(conflict);
        await notify(collection.slug, record.id, "create");
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

      const working = existing.draftData ?? existing.data;
      if (typeof o.data !== "object" || o.data === null || Array.isArray(o.data)) {
        throw new XenonError("VALIDATION", "The submitted data is invalid.", [
          { path: [], message: "Expected an object" },
        ]);
      }
      // Validate the merged document so required-field rules see the whole picture.
      const merged = { ...pickFields(collection, working), ...(o.data as AnyDoc) };
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

      const slug = wasPublished(existing) && existing.slug ? existing.slug : await uniqueSlug(collection, data, existing.id);
      try {
        const record = await requireDb()
          .update(
            collection.slug,
            existing.id,
            asDraft
              ? { slug, draftData: data }
              : { slug, data, draftData: null, status: "published" },
          )
          .catch(conflict);
        if (!record) throw new XenonError("NOT_FOUND", `Document "${o.id}" not found in "${collection.slug}".`);
        if (stored) {
          const oldKey = storageKeyOf(existing);
          if (oldKey) await requireStorage().delete(oldKey).catch(() => {});
        }
        await notify(collection.slug, record.id, "update");
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
