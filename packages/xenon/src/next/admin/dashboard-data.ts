import type { DocumentRecord } from "../../adapters/types";
import type { XenonConfig, XenonUser } from "../../core/types";
import type { XenonInstance } from "../../server/types";
import type { DashboardCollection, DashboardData, DashboardDoc } from "../../ui/shared/services";
import { summaryTitle } from "./action";

const ACTIVITY_DAYS = 30;
const LIST_SIZE = 6;

/**
 * Builds everything the dashboard shows in one pass per collection.
 *
 * Access is checked through the Local API (so `access.read` still decides what a user may see); the
 * numbers come from raw adapter records because "unpublished changes" (`draftData` on a published
 * document) isn't visible through the Local API. Xenon keeps no edit history, so activity is
 * "documents by last-edited day" and "documents created per day".
 */
export async function loadDashboard(xenon: XenonInstance, config: XenonConfig, user: XenonUser): Promise<DashboardData> {
  const since = Date.now() - ACTIVITY_DAYS * 86_400_000;
  const edited: string[] = [];
  const created: string[] = [];
  const attention: DashboardDoc[] = [];
  const recent: DashboardDoc[] = [];
  const collections: DashboardCollection[] = [];

  for (const collection of config.collections) {
    try {
      // Throws FORBIDDEN when this user may not read drafts of the collection.
      await xenon.find({ collection: collection.slug, draft: true, limit: 1, user, overrideAccess: false });
    } catch {
      continue;
    }
    const records = config.db ? (await config.db.find({ collection: collection.slug, source: "draft", limit: 0 })).docs : [];
    const drafts = collection.drafts !== false && !collection.upload;
    const stat: DashboardCollection = { slug: collection.slug, total: records.length, published: 0, drafts: 0, changed: 0, bytes: collection.upload ? 0 : null };

    for (const record of records) {
      const data = { ...(record.data ?? {}), ...(record.draftData ?? {}) };
      const changed = record.status === "published" && record.draftData !== null;
      if (record.status === "published") stat.published++;
      else stat.drafts++;
      if (changed && drafts) stat.changed++;
      if (stat.bytes !== null && typeof data.filesize === "number") stat.bytes += data.filesize;

      const updated = toIso(record.updatedAt);
      const createdAt = toIso(record.createdAt);
      if (Date.parse(updated) >= since) edited.push(updated);
      if (Date.parse(createdAt) >= since) created.push(createdAt);

      const doc = summary(collection, record, data, drafts && changed);
      recent.push(doc);
      if (drafts && (record.status === "draft" || changed)) attention.push(doc);
    }
    collections.push(stat);
  }

  recent.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // Oldest first: the longer something has waited, the more it needs a look.
  attention.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return {
    collections,
    recent: recent.slice(0, 8),
    attention: attention.slice(0, LIST_SIZE),
    attentionTotal: attention.length,
    activity: { days: ACTIVITY_DAYS, edited, created },
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function summary(collection: XenonConfig["collections"][number], record: DocumentRecord, data: Record<string, unknown>, changed: boolean): DashboardDoc {
  return {
    id: record.id,
    collection: collection.slug,
    title: summaryTitle(collection, data),
    status: record.status,
    changed,
    updatedAt: toIso(record.updatedAt),
  };
}
