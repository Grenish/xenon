/**
 * Scheduled publishing (#16). A schedule lives on the document row (`publishAt` / `unpublishAt`).
 * `runScheduled` (cron) publishes / unpublishes due documents through the regular Local API write
 * path; published reads hide a document from its `unpublishAt` on, even before cron runs.
 * Semantics: docs/CONTRACTS.md §7.8.
 */
import type { DatabaseAdapter, DocumentRecord } from "../adapters/types";
import { isXenonError, XenonError } from "../core/errors";
import type { AnyCollection, XenonConfig } from "../core/types";
import type { CallContext, DocumentSchedule, ScheduledRunResult, XenonInstance } from "./types";

type AnyDoc = Record<string, unknown>;

const DEFAULT_RUN_LIMIT = 100;

/** `true` when a published read may return this record at `now` (status and scheduled unpublish). */
export function isLive(record: DocumentRecord, now = new Date()): boolean {
  return record.status === "published" && !(record.unpublishAt && record.unpublishAt.getTime() <= now.getTime());
}

export function scheduleOf(record: DocumentRecord): DocumentSchedule {
  return {
    publishAt: record.publishAt ? record.publishAt.toISOString() : null,
    unpublishAt: record.unpublishAt ? record.unpublishAt.toISOString() : null,
  };
}

/** A pending working copy exists: a draft, or a published document with unpublished changes. */
export function hasPendingChanges(record: DocumentRecord): boolean {
  return record.status !== "published" || record.draftData !== null;
}

function instant(value: unknown, key: "publishAt" | "unpublishAt"): Date | null | undefined {
  if (value === undefined || value === null) return value;
  const date = value instanceof Date ? new Date(value) : typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new XenonError("VALIDATION", "The submitted schedule is invalid.", [{ path: [key], message: "Expected an ISO date" }]);
  }
  return date;
}

function isStale(err: unknown): boolean {
  return isXenonError(err) && err.code === "CONFLICT" && (err.issues ?? []).some((i) => i.path[0] === "updatedAt");
}

export interface ScheduleRuntime {
  init(): Promise<void>;
  requireDb(): DatabaseAdapter;
  requireCollection(slug: string): AnyCollection;
  getCollection(slug: string): AnyCollection | undefined;
  checkAccess(collection: AnyCollection, op: "read" | "update", ctx: CallContext, draft?: boolean): Promise<void>;
  draftsEnabled(collection: AnyCollection): boolean;
  update(options: AnyDoc): Promise<unknown>;
  unpublish(options: AnyDoc): Promise<unknown>;
}

export function createScheduleMethods(
  rt: ScheduleRuntime,
): Pick<XenonInstance<XenonConfig>, "getSchedule" | "schedule" | "runScheduled"> {
  function schedulable(slug: string): { collection: AnyCollection; db: DatabaseAdapter } {
    const collection = rt.requireCollection(slug);
    if (!rt.draftsEnabled(collection)) {
      throw new XenonError("BAD_REQUEST", `"${collection.slug}" does not use drafts, so it can't be scheduled.`);
    }
    const db = rt.requireDb();
    if (!db.findDue) throw new XenonError("NOT_IMPLEMENTED", "The database adapter does not support scheduled publishing.");
    return { collection, db };
  }

  async function getRecord(db: DatabaseAdapter, collection: AnyCollection, id: string): Promise<DocumentRecord> {
    const record = await db.findById(collection.slug, id);
    if (!record) throw new XenonError("NOT_FOUND", `Document "${id}" not found in "${collection.slug}".`);
    return record;
  }

  return {
    async getSchedule(o) {
      await rt.init();
      const { collection, db } = schedulable(o.collection);
      await rt.checkAccess(collection, "read", o, true);
      return scheduleOf(await getRecord(db, collection, o.id));
    },

    async schedule(o) {
      await rt.init();
      const { collection, db } = schedulable(o.collection);
      await rt.checkAccess(collection, "update", o);
      const existing = await getRecord(db, collection, o.id);
      const publishAt = instant(o.publishAt, "publishAt");
      const unpublishAt = instant(o.unpublishAt, "unpublishAt");
      if (publishAt && !hasPendingChanges(existing)) {
        const message = "There are no unpublished changes to schedule. Save a draft first.";
        throw new XenonError("VALIDATION", message, [{ path: ["publishAt"], message }]);
      }
      const nextPublish = publishAt === undefined ? (existing.publishAt ?? null) : publishAt;
      const nextUnpublish = unpublishAt === undefined ? (existing.unpublishAt ?? null) : unpublishAt;
      if (nextPublish && nextUnpublish && nextUnpublish.getTime() <= nextPublish.getTime()) {
        const message = "Unpublish time must be after the publish time.";
        throw new XenonError("VALIDATION", message, [{ path: ["unpublishAt"], message }]);
      }
      if (publishAt === undefined && unpublishAt === undefined) return scheduleOf(existing);
      const record = await db.update(collection.slug, existing.id, {
        ...(publishAt !== undefined ? { publishAt } : {}),
        ...(unpublishAt !== undefined ? { unpublishAt } : {}),
      });
      if (!record) throw new XenonError("NOT_FOUND", `Document "${o.id}" not found in "${collection.slug}".`);
      return scheduleOf(record);
    },

    async runScheduled(o = {}) {
      await rt.init();
      const db = rt.requireDb();
      if (!db.findDue) throw new XenonError("NOT_IMPLEMENTED", "The database adapter does not support scheduled publishing.");
      const now = o.now ?? new Date();
      const limit = Math.max(1, Math.floor(o.limit ?? DEFAULT_RUN_LIMIT));
      const result: ScheduledRunResult = { published: [], unpublished: [], failed: [] };
      const ctx = { overrideAccess: true, context: o.context ?? { scheduled: true } };

      for (const due of await db.findDue({ now, limit })) {
        const collection = rt.getCollection(due.collection);
        // Rows of removed collections, or ones that no longer use drafts: drop the stale schedule.
        if (!collection || !rt.draftsEnabled(collection)) {
          await db.update(due.collection, due.id, { publishAt: null, unpublishAt: null }).catch(() => {});
          continue;
        }
        const ref = { collection: collection.slug, id: due.id };
        let current: DocumentRecord | null = due;

        if (due.publishAt && due.publishAt.getTime() <= now.getTime()) {
          try {
            // Publishes the working copy as it is now (an empty patch), like pressing Publish.
            await rt.update({ ...ctx, ...ref, data: {}, draft: false, expectedUpdatedAt: due.updatedAt });
            result.published.push(ref);
          } catch (err) {
            // Saved by someone in between: the next run re-reads it.
            if (isStale(err)) continue;
            result.failed.push({ ...ref, action: "publish", message: err instanceof Error ? err.message : String(err) });
            // A rejected publish (validation, conflict) would fail the same way every run.
            if (isXenonError(err)) await db.update(collection.slug, due.id, { publishAt: null }).catch(() => {});
          }
          current = await db.findById(collection.slug, due.id);
        }

        if (current?.unpublishAt && current.status === "published" && current.unpublishAt.getTime() <= now.getTime()) {
          try {
            await rt.unpublish({ ...ctx, ...ref });
            result.unpublished.push(ref);
          } catch (err) {
            result.failed.push({ ...ref, action: "unpublish", message: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      return result;
    },
  };
}
