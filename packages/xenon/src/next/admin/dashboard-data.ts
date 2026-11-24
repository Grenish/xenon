import { summarizeRecords, workingData } from "../../adapters/summary";
import type { CollectionSummary, DocumentRecord, SummarizeArgs } from "../../adapters/types";
import type { XenonConfig, XenonUser } from "../../core/types";
import type { XenonInstance } from "../../server/types";
import type { DashboardCollection, DashboardData, DashboardDoc, DashboardMedia } from "../../ui/shared/services";
import { summaryTitle } from "./action";

const ACTIVITY_DAYS = 30;
const LIST_SIZE = 6;
const RECENT_SIZE = 8;
const MEDIA_SIZE = 6;

/** Internal storage metadata on upload records (see FILE_KEY in server/xenon.ts). */
const FILE_KEY = "_file";

/**
 * Builds everything the dashboard shows.
 *
 * Access is checked through the Local API (so `access.read` still decides what a user may see); the
 * numbers come from raw adapter records because "unpublished changes" (`draftData` on a published
 * document) isn't visible through the Local API. Adapters with `summarize` (PostgreSQL / PGlite)
 * aggregate in the database; others fall back to `summarizeRecords` over every record. Xenon keeps no
 * edit history, so activity is "documents by last-edited day" and "documents created per day".
 */
export async function loadDashboard(xenon: XenonInstance, config: XenonConfig, user: XenonUser): Promise<DashboardData> {
  const since = new Date(Date.now() - ACTIVITY_DAYS * 86_400_000);
  const edited: string[] = [];
  const created: string[] = [];
  const attention: DashboardDoc[] = [];
  let attentionTotal = 0;
  const recent: DashboardDoc[] = [];
  const collections: DashboardCollection[] = [];
  const media: DashboardMedia[] = [];

  for (const collection of config.collections) {
    try {
      // Throws FORBIDDEN when this user may not read drafts of the collection.
      await xenon.find({ collection: collection.slug, draft: true, limit: 1, user, overrideAccess: false });
    } catch {
      continue;
    }
    const upload = !!collection.upload;
    const drafts = collection.drafts !== false && !upload;
    const summary = await summarize(config, {
      collection: collection.slug,
      since,
      recent: RECENT_SIZE,
      attention: drafts ? LIST_SIZE : 0,
      images: upload ? MEDIA_SIZE : 0,
    });
    collections.push({
      slug: collection.slug,
      total: summary.total,
      published: summary.published,
      drafts: summary.drafts,
      changed: drafts ? summary.changed : 0,
      bytes: upload ? summary.bytes : null,
    });
    for (const at of summary.edited) edited.push(at.toISOString());
    for (const at of summary.created) created.push(at.toISOString());

    for (const record of summary.images) {
      const data = workingData(record);
      const url = fileUrl(config, record);
      if (!url) continue;
      media.push({ id: record.id, collection: collection.slug, url, alt: typeof data.alt === "string" && data.alt ? data.alt : summaryTitle(collection, data), updatedAt: toIso(record.updatedAt) });
    }
    for (const record of summary.recent) recent.push(summaryDoc(collection, record, drafts));
    if (drafts) {
      for (const record of summary.attention) attention.push(summaryDoc(collection, record, drafts));
      attentionTotal += summary.attentionTotal;
    }
  }

  recent.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // Oldest first: the longer something has waited, the more it needs a look.
  attention.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  media.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    collections,
    media: media.slice(0, MEDIA_SIZE),
    recent: recent.slice(0, RECENT_SIZE),
    attention: attention.slice(0, LIST_SIZE),
    attentionTotal,
    activity: { days: ACTIVITY_DAYS, edited, created },
  };
}

async function summarize(config: XenonConfig, args: SummarizeArgs): Promise<CollectionSummary> {
  const db = config.db;
  if (!db) return summarizeRecords([], args);
  if (db.summarize) return db.summarize(args);
  return summarizeRecords((await db.find({ collection: args.collection, source: "draft", limit: 0 })).docs, args);
}

/** The file's current public URL, derived like `toDoc()` does (so a changed `publicUrl`/`baseUrl` applies). */
function fileUrl(config: XenonConfig, record: DocumentRecord): string | null {
  const file = record.data[FILE_KEY] as { key?: unknown } | undefined;
  if (typeof file?.key === "string" && config.storage) return config.storage.getUrl(file.key);
  const url = record.data.url;
  return typeof url === "string" ? url : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function summaryDoc(collection: XenonConfig["collections"][number], record: DocumentRecord, drafts: boolean): DashboardDoc {
  return {
    id: record.id,
    collection: collection.slug,
    // The working copy as-is: merging live data under it would resurrect fields cleared in the draft.
    title: summaryTitle(collection, workingData(record)),
    status: record.status,
    changed: drafts && record.status === "published" && record.draftData !== null,
    updatedAt: toIso(record.updatedAt),
  };
}
