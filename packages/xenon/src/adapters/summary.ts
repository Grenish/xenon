import { compareStrings } from "./match";
import type { CollectionSummary, DocumentRecord, SummarizeArgs } from "./types";

/** The record's working copy: its pending draft if any, else its live data. */
export function workingData(record: DocumentRecord): Record<string, unknown> {
  return record.draftData ?? record.data ?? {};
}

export function needsAttention(record: DocumentRecord): boolean {
  return record.status !== "published" || record.draftData !== null;
}

export function isImageRecord(record: DocumentRecord): boolean {
  const mimeType = workingData(record).mimeType;
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

const byUpdated = (a: DocumentRecord, b: DocumentRecord) =>
  a.updatedAt.getTime() - b.updatedAt.getTime() || compareStrings(a.id, b.id);
const byUpdatedDesc = (a: DocumentRecord, b: DocumentRecord) =>
  b.updatedAt.getTime() - a.updatedAt.getTime() || compareStrings(a.id, b.id);

/** Portable `DatabaseAdapter.summarize` over already-loaded records of one collection. */
export function summarizeRecords(records: readonly DocumentRecord[], args: SummarizeArgs): CollectionSummary {
  const since = args.since.getTime();
  const summary: CollectionSummary = {
    total: records.length, published: 0, drafts: 0, changed: 0, bytes: 0,
    edited: [], created: [], recent: [], attention: [], attentionTotal: 0, images: [],
  };
  const attention: DocumentRecord[] = [];
  for (const record of records) {
    if (record.status === "published") {
      summary.published++;
      if (record.draftData !== null) summary.changed++;
    } else summary.drafts++;
    const filesize = workingData(record).filesize;
    if (typeof filesize === "number" && Number.isFinite(filesize)) summary.bytes += filesize;
    if (record.updatedAt.getTime() >= since) summary.edited.push(record.updatedAt);
    if (record.createdAt.getTime() >= since) summary.created.push(record.createdAt);
    if (needsAttention(record)) attention.push(record);
  }
  const newest = [...records].sort(byUpdatedDesc);
  summary.recent = newest.slice(0, args.recent);
  summary.images = newest.filter(isImageRecord).slice(0, args.images);
  summary.attention = attention.sort(byUpdated).slice(0, args.attention);
  summary.attentionTotal = attention.length;
  return summary;
}
