/**
 * Version history (#15). Snapshots are written by the Local API write path (`snapshotVersion`);
 * this module reads and restores them. Semantics: docs/CONTRACTS.md §7.7.
 */
import type { DatabaseAdapter, DocumentRecord, VersionKind, VersionRecord } from "../adapters/types";
import { versionsMax } from "../core/collection";
import { pruneToFields } from "../core/defaults";
import { XenonError } from "../core/errors";
import type { AnyCollection, XenonConfig, XenonUser } from "../core/types";
import type { CallContext, DocumentVersion, XenonInstance } from "./types";

type AnyDoc = Record<string, unknown>;

/** Internal `update` option: the write restores a version (snapshot kind `restore`). */
export const RESTORE_VERSION = Symbol("xenon.restoreVersion");

type VersionStore = Required<Pick<DatabaseAdapter, "createVersion" | "findVersions" | "findVersionById" | "deleteVersions">>;

export function hasVersionStore(db: DatabaseAdapter | undefined): db is DatabaseAdapter & VersionStore {
  return Boolean(db?.createVersion && db.findVersions && db.findVersionById && db.deleteVersions);
}

/** Throws at init when a collection keeps versions but the adapter can't store them. */
export function assertVersionSupport(config: XenonConfig): void {
  const versioned = config.collections.filter((c) => versionsMax(c) !== null);
  if (versioned.length && !hasVersionStore(config.db)) {
    throw new Error(
      `[xenon] Collection "${versioned[0]!.slug}" keeps versions, but the "${config.db?.name ?? "configured"}" database adapter does not implement createVersion / findVersions / findVersionById / deleteVersions.`,
    );
  }
}

/** Saves a version of `record` after a write and trims old ones. No-op when versions are off. */
export async function snapshotVersion(
  db: DatabaseAdapter,
  collection: AnyCollection,
  record: DocumentRecord,
  kind: VersionKind,
  user: XenonUser | null,
): Promise<void> {
  const max = versionsMax(collection);
  if (max === null || !hasVersionStore(db)) return;
  await db.createVersion({
    collection: collection.slug,
    documentId: record.id,
    kind,
    slug: record.slug,
    data: kind === "publish" ? record.data : (record.draftData ?? record.data),
    author: user ? { id: user.id, name: user.name ?? null, email: user.email ?? null } : null,
  });
  await db.deleteVersions(collection.slug, record.id, { keep: max });
}

export interface VersionRuntime {
  init(): Promise<void>;
  requireDb(): DatabaseAdapter;
  requireCollection(slug: string): AnyCollection;
  checkAccess(collection: AnyCollection, op: "read" | "update", ctx: CallContext, draft?: boolean): Promise<void>;
  toDoc(collection: AnyCollection, record: DocumentRecord, draft: boolean): AnyDoc;
  /** Collection/field `afterRead` hooks for a document read on behalf of `ctx`. */
  afterRead(collection: AnyCollection, doc: AnyDoc, ctx: CallContext): Promise<AnyDoc>;
  draftsEnabled(collection: AnyCollection): boolean;
  /** Runs an `update` with internal options (late-bound: the API object is built after this module). */
  update(options: AnyDoc): Promise<AnyDoc>;
}

export function createVersionMethods(
  rt: VersionRuntime,
): Pick<XenonInstance<XenonConfig>, "findVersions" | "findVersionById" | "restoreVersion"> {
  function versioned(slug: string): { collection: AnyCollection; db: DatabaseAdapter & VersionStore } {
    const collection = rt.requireCollection(slug);
    if (versionsMax(collection) === null) {
      throw new XenonError("BAD_REQUEST", `"${collection.slug}" does not keep versions.`);
    }
    const db = rt.requireDb();
    if (!hasVersionStore(db)) {
      throw new XenonError("NOT_IMPLEMENTED", "The database adapter does not support versions.");
    }
    return { collection, db };
  }

  /** The version as a document: field values read through the current schema and defaults. */
  async function toVersion(
    collection: AnyCollection,
    version: VersionRecord,
    owner: DocumentRecord,
    ctx: CallContext,
  ): Promise<DocumentVersion<AnyDoc>> {
    const record: DocumentRecord = {
      id: version.documentId,
      collection: collection.slug,
      slug: version.slug,
      status: version.kind === "publish" ? "published" : "draft",
      data: version.data,
      draftData: version.kind === "publish" ? null : version.data,
      createdAt: owner.createdAt,
      updatedAt: version.createdAt,
    };
    const doc = await rt.afterRead(collection, rt.toDoc(collection, record, true), ctx);
    return {
      id: version.id,
      documentId: version.documentId,
      kind: version.kind,
      createdAt: version.createdAt.toISOString(),
      author: version.author,
      doc,
    };
  }

  return {
    async findVersions(o) {
      await rt.init();
      const { collection, db } = versioned(o.collection);
      await rt.checkAccess(collection, "read", o, true);
      const owner = await db.findById(collection.slug, o.id);
      if (!owner) throw new XenonError("NOT_FOUND", `Document "${o.id}" not found in "${collection.slug}".`);
      const limit = Math.min(Math.max(1, Math.floor(o.limit ?? 10)), 100);
      const page = Math.max(1, Math.floor(o.page ?? 1));
      const result = await db.findVersions({ collection: collection.slug, documentId: owner.id, limit, page });
      const docs = await Promise.all(result.docs.map((v) => toVersion(collection, v, owner, o)));
      return { ...result, docs } as never;
    },

    async findVersionById(o) {
      await rt.init();
      const { collection, db } = versioned(o.collection);
      await rt.checkAccess(collection, "read", o, true);
      const version = await db.findVersionById(collection.slug, o.id);
      if (!version) return null;
      const owner = await db.findById(collection.slug, version.documentId);
      if (!owner) return null;
      return (await toVersion(collection, version, owner, o)) as never;
    },

    async restoreVersion(o) {
      await rt.init();
      const { collection, db } = versioned(o.collection);
      await rt.checkAccess(collection, "update", o);
      const version = await db.findVersionById(collection.slug, o.id);
      if (!version) throw new XenonError("NOT_FOUND", `Version "${o.id}" not found in "${collection.slug}".`);
      // Every field is set explicitly: ones the version didn't have become empty instead of keeping
      // today's value, so the result matches the version. The slug is left as it is.
      const stored = pruneToFields(collection.fields, version.data);
      const data: AnyDoc = {};
      for (const key of Object.keys(collection.fields)) data[key] = Object.hasOwn(stored, key) ? stored[key] : null;
      return (await rt.update({
        ...o,
        collection: collection.slug,
        id: version.documentId,
        data,
        draft: o.draft ?? rt.draftsEnabled(collection),
        [RESTORE_VERSION]: true,
      })) as never;
    },
  };
}
