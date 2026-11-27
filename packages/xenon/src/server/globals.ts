import type { DatabaseAdapter, DocumentRecord } from "../adapters/types";
import { SlugConflictError, UpdateConflictError } from "../adapters/types";
import { mergeUpdate, pruneToFields, withReadDefaults } from "../core/defaults";
import { XenonError } from "../core/errors";
import { type AnyGlobal, GLOBALS_COLLECTION, validateGlobalData } from "../core/global";
import type { AnyCollection, XenonConfig } from "../core/types";
import type { ValidationMode } from "../core/validation";
import { applySelect, populateDocs, validatePopulate, validateSelect } from "./populate";
import type { CallContext, XenonInstance } from "./types";

type AnyDoc = Record<string, unknown>;

export interface GlobalRuntime {
  config: XenonConfig;
  globals: Map<string, AnyGlobal>;
  init: () => Promise<void>;
  requireDb: () => DatabaseAdapter;
  getCollection: (slug: string) => AnyCollection | undefined;
  checkCollectionReadAccess: (collection: AnyCollection, ctx: CallContext, draft: boolean) => Promise<void>;
  toCollectionDoc: (collection: AnyCollection, record: DocumentRecord, draft: boolean) => AnyDoc;
  notifyGlobal: (slug: string, id: string, op: "update" | "unpublish", draft: boolean) => Promise<void>;
}

/** Looks up the singleton row for a global in `xenon_documents` (`collection = "_xenon_globals"`, `slug`). */
export async function findGlobalRecord(db: DatabaseAdapter, slug: string): Promise<DocumentRecord | null> {
  const { docs } = await db.find({
    collection: GLOBALS_COLLECTION,
    source: "draft",
    where: { slug: { equals: slug } },
    limit: 1,
  });
  return docs[0] ?? null;
}

function staleError(): XenonError {
  const message = "This global was saved by someone else after you opened it.";
  return new XenonError("CONFLICT", message, [{ path: ["updatedAt"], message }]);
}

function expectedVersion(value: string | Date | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new XenonError("BAD_REQUEST", "expectedUpdatedAt must be an ISO date.");
  return date;
}

function toGlobalDoc(global: AnyGlobal, record: DocumentRecord, draft: boolean): AnyDoc {
  const source = draft ? (record.draftData ?? record.data) : record.data;
  const fields = withReadDefaults(global.fields, source);
  return {
    id: record.id,
    slug: global.slug,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...fields,
  };
}

function validate(global: AnyGlobal, data: unknown, mode: ValidationMode): AnyDoc {
  const result = validateGlobalData(global, data, { mode });
  if (!result.success) {
    throw new XenonError("VALIDATION", "The submitted data is invalid.", result.issues);
  }
  return result.data as AnyDoc;
}

export function createGlobalMethods(
  rt: GlobalRuntime,
): Pick<XenonInstance<XenonConfig>, "getGlobal" | "updateGlobal" | "unpublishGlobal"> {
  function requireGlobal(slug: string): AnyGlobal {
    const g = rt.globals.get(slug);
    if (!g) throw new XenonError("NOT_FOUND", `Unknown global "${slug}".`);
    return g;
  }

  async function checkGlobalAccess(global: AnyGlobal, op: "read" | "update", ctx: CallContext, draft = false) {
    if (ctx.overrideAccess !== false) return;
    const user = ctx.user ?? null;
    const fn = global.access?.[op];
    const allowed = fn ? await fn({ user }) : op === "read" && !draft ? true : user !== null;
    if (allowed && op === "read" && draft && !user) {
      throw new XenonError("UNAUTHORIZED", "Sign in to read drafts.");
    }
    if (!allowed) {
      throw user
        ? new XenonError("FORBIDDEN", `You are not allowed to ${op} "${global.slug}".`)
        : new XenonError("UNAUTHORIZED", "Authentication required.");
    }
  }

  return {
    async getGlobal(o) {
      await rt.init();
      const global = requireGlobal(o.slug);
      const draft = o.draft === true;
      await checkGlobalAccess(global, "read", o, draft);

      const select = o.select !== undefined ? validateSelect(global, o.select) : undefined;
      const pop = o.populate !== undefined ? validatePopulate(global, o.populate, rt.getCollection) : undefined;
      if (pop) {
        for (const target of pop.targets) {
          await rt.checkCollectionReadAccess(target, o, draft);
        }
      }

      const db = rt.requireDb();
      const record = await findGlobalRecord(db, global.slug);
      if (!record || (!draft && record.status !== "published")) return null;

      let doc = toGlobalDoc(global, record, draft);
      if (pop?.spec) {
        await populateDocs({
          collection: global,
          docs: [doc],
          spec: pop.spec,
          draft,
          db,
          getCollection: rt.getCollection,
          toDoc: rt.toCollectionDoc,
        });
      }
      if (select) {
        doc = applySelect(doc, select, pop?.spec, true);
      }
      return doc as never;
    },

    async updateGlobal(o) {
      await rt.init();
      const global = requireGlobal(o.slug);
      await checkGlobalAccess(global, "update", o);
      if (typeof o.data !== "object" || o.data === null || Array.isArray(o.data)) {
        throw new XenonError("VALIDATION", "The submitted data is invalid.", [
          { path: [], message: "Expected an object" },
        ]);
      }

      const asDraft = global.drafts !== false && o.draft === true;
      const ifUpdatedAt = expectedVersion(o.expectedUpdatedAt);
      const db = rt.requireDb();
      let existing = await findGlobalRecord(db, global.slug);

      if (!existing) {
        if (ifUpdatedAt) throw staleError();
        const data = validate(global, o.data, asDraft ? "draft" : "create");
        try {
          const created = await db.create({
            collection: GLOBALS_COLLECTION,
            slug: global.slug,
            status: asDraft ? "draft" : "published",
            data: asDraft ? {} : data,
            draftData: asDraft ? data : null,
          });
          await rt.notifyGlobal(global.slug, created.id, "update", asDraft);
          return toGlobalDoc(global, created, asDraft) as never;
        } catch (err) {
          if (!(err instanceof SlugConflictError)) throw err;
          // Another concurrent first-time write created the singleton row first; re-read and merge into it.
          existing = await findGlobalRecord(db, global.slug);
          if (!existing) throw staleError();
        }
      }

      if (ifUpdatedAt && existing.updatedAt.getTime() !== ifUpdatedAt.getTime()) throw staleError();
      const working = existing.draftData ?? existing.data;
      const merged = mergeUpdate(global.fields, pruneToFields(global.fields, working), o.data as AnyDoc);
      const data = validate(global, merged, asDraft ? "draft" : "create");

      let record: DocumentRecord | null;
      try {
        record = await db.update(
          GLOBALS_COLLECTION,
          existing.id,
          asDraft
            ? { draftData: data }
            : { data, draftData: null, status: "published" },
          ifUpdatedAt ? { ifUpdatedAt } : undefined,
        );
      } catch (err) {
        if (err instanceof UpdateConflictError) throw staleError();
        throw err;
      }
      if (!record) throw new XenonError("NOT_FOUND", `Global "${global.slug}" not found.`);
      await rt.notifyGlobal(global.slug, record.id, "update", asDraft);
      return toGlobalDoc(global, record, asDraft) as never;
    },

    async unpublishGlobal(o) {
      await rt.init();
      const global = requireGlobal(o.slug);
      await checkGlobalAccess(global, "update", o);
      if (global.drafts === false) {
        throw new XenonError("BAD_REQUEST", `"${global.slug}" does not use drafts.`);
      }
      const db = rt.requireDb();
      const existing = await findGlobalRecord(db, global.slug);
      if (!existing) throw new XenonError("NOT_FOUND", `Global "${global.slug}" has not been saved yet.`);
      const record = await db.update(GLOBALS_COLLECTION, existing.id, {
        status: "draft",
        draftData: existing.draftData ?? existing.data,
      });
      if (!record) throw new XenonError("NOT_FOUND", `Global "${global.slug}" not found.`);
      await rt.notifyGlobal(global.slug, record.id, "unpublish", false);
      return toGlobalDoc(global, record, true) as never;
    },
  };
}
