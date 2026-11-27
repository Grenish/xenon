"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RiHistoryLine } from "@remixicon/react";
import type { RichTextDocument } from "../../core/types";
import { richTextToPlainText } from "../../react/rich-text";
import { formatDate, timeAgo } from "../admin/format";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/alert-dialog";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/sheet";
import { Spinner } from "../components/spinner";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import type { ClientCollection, ClientField } from "../shared/client-config";
import type { AdminDoc, AdminVersion } from "../shared/services";
import { initialData, normalizeFormData } from "./model";

const KIND_LABEL: Record<AdminVersion["kind"], string> = { publish: "Published", draft: "Draft saved", restore: "Restored" };

/** A short, readable rendering of one field value for the comparison. */
function preview(field: ClientField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "richText") return richTextToPlainText(value as RichTextDocument).trim() || "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length === 0) return "—";
  // Row ids are internal: leave them out so the text shows what an editor can see.
  const json = JSON.stringify(value, (key, v) => (key === "id" ? undefined : v));
  return json.length > 160 ? `${json.slice(0, 157)}…` : json;
}

export interface FieldChange {
  field: ClientField;
  version: string;
  current: string;
}

/** Top-level fields whose value in `version` differs from the editor's `current` data. */
export function diffVersion(collection: ClientCollection, version: Record<string, unknown>, current: Record<string, unknown>): FieldChange[] {
  const before = normalizeFormData(collection.fields, initialData(collection, { data: version } as AdminDoc));
  const after = normalizeFormData(collection.fields, current);
  const changes: FieldChange[] = [];
  for (const field of collection.fields) {
    if (field.admin.hidden) continue;
    if (JSON.stringify(before[field.name] ?? null) === JSON.stringify(after[field.name] ?? null)) continue;
    changes.push({ field, version: preview(field, before[field.name]), current: preview(field, after[field.name]) });
  }
  return changes;
}

export function VersionHistory({ collection, doc, data, dirty, readOnly, open, onOpenChange, onRestored }: {
  collection: ClientCollection;
  doc: AdminDoc;
  /** The editor's current (possibly unsaved) values, compared against each version. */
  data: Record<string, unknown>;
  dirty: boolean;
  readOnly: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRestored(doc: AdminDoc): void;
}) {
  const { services } = useAdmin();
  const [versions, setVersions] = useState<AdminVersion[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);

  async function load(nextPage: number) {
    setLoading(true);
    try {
      const result = await services.versions({ collection: collection.slug, id: doc.id, page: nextPage });
      if (!result.ok) { toast.error(result.error.message); return; }
      setVersions((previous) => (nextPage === 1 ? result.data.docs : [...(previous ?? []), ...result.data.docs]));
      setPage(nextPage);
      setHasMore(result.data.hasNextPage);
      if (nextPage === 1) setSelected((current) => current ?? result.data.docs[0]?.id ?? null);
    } catch { toast.error("Could not load the history. Try again."); }
    finally { setLoading(false); }
  }

  // Reload whenever the sheet opens or the document gets a new version.
  useEffect(() => {
    if (!open) return;
    setSelected(null);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc.id, doc.updatedAt]);

  const version = versions?.find((v) => v.id === selected) ?? null;
  const changes = useMemo(() => (version ? diffVersion(collection, version.data, data) : []), [collection, version, data]);

  async function restore() {
    if (!version || restoring) return;
    setRestoring(true);
    try {
      const result = await services.restoreVersion({ collection: collection.slug, id: doc.id, versionId: version.id, expectedUpdatedAt: doc.updatedAt });
      if (!result.ok) { toast.error(result.error.message); return; }
      setConfirm(false);
      onOpenChange(false);
      onRestored(result.data);
      toast.success(collection.drafts ? "Version restored as a draft" : "Version restored");
    } catch { toast.error("Could not restore this version. Try again."); }
    finally { setRestoring(false); }
  }

  return <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="xe:w-full xe:gap-0 xe:p-0 xe:data-[side=right]:sm:max-w-xl">
        <SheetHeader className="xe:border-b xe:border-border xe:px-5 xe:py-4">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>Compare a saved version with what's in the editor, and restore it{collection.drafts ? " as a draft" : ""}.</SheetDescription>
        </SheetHeader>
        <div className="xe:grid xe:min-h-0 xe:flex-1 xe:grid-rows-[minmax(0,14rem)_minmax(0,1fr)] xe:sm:grid-cols-[13rem_minmax(0,1fr)] xe:sm:grid-rows-1">
          <ol aria-label="Versions" className="xe:flex xe:flex-col xe:overflow-y-auto xe:border-b xe:border-border xe:p-2 xe:sm:border-r xe:sm:border-b-0 xe:[scrollbar-width:thin]">
            {versions === null ? <li className="xe:flex xe:justify-center xe:p-4"><Spinner /></li> : null}
            {versions?.length === 0 ? <li className="xe:p-3 xe:text-[13px] xe:text-muted-foreground">No versions yet. One is saved each time you publish or save a draft.</li> : null}
            {versions?.map((v) => (
              <li key={v.id}>
                <button type="button" aria-current={v.id === selected ? "true" : undefined} onClick={() => setSelected(v.id)}
                  className={cn("xe:flex xe:w-full xe:flex-col xe:gap-0.5 xe:rounded-md xe:px-3 xe:py-2 xe:text-left xe:text-[13px] xe:transition-colors xe:hover:bg-muted", v.id === selected && "xe:bg-muted")}>
                  <span className="xe:font-medium" suppressHydrationWarning>{timeAgo(v.createdAt)}</span>
                  <span className="xe:truncate xe:text-xs xe:text-muted-foreground">{KIND_LABEL[v.kind]}{v.author ? ` · ${v.author.name || v.author.email || "Someone"}` : ""}</span>
                </button>
              </li>
            ))}
            {hasMore ? <li className="xe:p-1"><Button type="button" variant="ghost" size="sm" className="xe:w-full" disabled={loading} onClick={() => void load(page + 1)}>{loading ? <Spinner /> : null}Load older</Button></li> : null}
          </ol>
          <section aria-label="Comparison" className="xe:flex xe:min-h-0 xe:flex-col xe:overflow-y-auto xe:[scrollbar-width:thin]">
            {version ? <>
              <div className="xe:flex xe:flex-wrap xe:items-center xe:justify-between xe:gap-2 xe:border-b xe:border-border xe:px-5 xe:py-3">
                <div className="xe:flex xe:min-w-0 xe:flex-col">
                  <p className="xe:text-[13px] xe:font-medium" suppressHydrationWarning>{formatDate(version.createdAt)}</p>
                  <p className="xe:text-xs xe:text-muted-foreground">{changes.length === 0 ? "Same as the editor" : `${changes.length} ${changes.length === 1 ? "field differs" : "fields differ"} from the editor`}</p>
                </div>
                <Button type="button" size="sm" disabled={readOnly || restoring || changes.length === 0} onClick={() => (dirty ? setConfirm(true) : void restore())}>
                  {restoring ? <Spinner /> : <RiHistoryLine data-icon="inline-start" />}Restore
                </Button>
              </div>
              <dl className="xe:flex xe:flex-col xe:divide-y xe:divide-border">
                {changes.map((change) => (
                  <div key={change.field.name} className="xe:flex xe:flex-col xe:gap-1.5 xe:px-5 xe:py-3">
                    <dt className="xe:text-xs xe:font-medium xe:text-muted-foreground">{change.field.label}</dt>
                    <dd className="xe:grid xe:gap-1.5 xe:text-[13px]">
                      <p className="xe:flex xe:gap-2"><Badge variant="outline" className="xe:h-5 xe:flex-none xe:px-1.5 xe:text-[11px]">Version</Badge><span className="xe:line-clamp-4 xe:break-words">{change.version}</span></p>
                      <p className="xe:flex xe:gap-2"><Badge variant="secondary" className="xe:h-5 xe:flex-none xe:px-1.5 xe:text-[11px]">Editor</Badge><span className="xe:line-clamp-4 xe:break-words">{change.current}</span></p>
                    </dd>
                  </div>
                ))}
              </dl>
            </> : versions?.length ? <p className="xe:p-5 xe:text-[13px] xe:text-muted-foreground">Choose a version to compare.</p> : null}
          </section>
        </div>
      </SheetContent>
    </Sheet>
    <AlertDialog open={confirm} onOpenChange={(next) => { if (!restoring) setConfirm(next); }}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>Restore this version?</AlertDialogTitle>
      <AlertDialogDescription>Your unsaved changes will be replaced by this version.</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter>
      <AlertDialogCancel disabled={restoring}>Keep editing</AlertDialogCancel>
      <AlertDialogAction variant="destructive" disabled={restoring} onClick={() => void restore()}>{restoring ? <Spinner /> : null}Restore version</AlertDialogAction>
    </AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
