"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RiCalendarScheduleLine } from "@remixicon/react";
import { formatDate } from "../admin/format";
import { Button } from "../components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../components/field";
import { Input } from "../components/input";
import { Spinner } from "../components/spinner";
import { useAdmin } from "../shared/admin-context";
import type { ClientCollection } from "../shared/client-config";
import type { AdminDoc } from "../shared/services";
import { fromLocalDateTime, toLocalDateTime } from "./scalar-fields";

/** Inspector rows for a pending schedule (nothing when none is set). */
export function ScheduleSummary({ doc }: { doc: AdminDoc | null }) {
  if (!doc?.publishAt && !doc?.unpublishAt) return null;
  return <>
    {doc.publishAt ? <div className="xe:flex xe:items-center xe:justify-between xe:gap-3"><dt className="xe:text-muted-foreground">Publishes</dt><dd><time dateTime={doc.publishAt} suppressHydrationWarning>{formatDate(doc.publishAt)}</time></dd></div> : null}
    {doc.unpublishAt ? <div className="xe:flex xe:items-center xe:justify-between xe:gap-3"><dt className="xe:text-muted-foreground">Unpublishes</dt><dd><time dateTime={doc.unpublishAt} suppressHydrationWarning>{formatDate(doc.unpublishAt)}</time></dd></div> : null}
  </>;
}

export function ScheduleDialog({ collection, doc, dirty, open, onOpenChange, onSaved }: {
  collection: ClientCollection;
  doc: AdminDoc;
  /** Unsaved edits aren't part of a scheduled publish: say so. */
  dirty: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(doc: AdminDoc): void;
}) {
  const { services } = useAdmin();
  const [publishAt, setPublishAt] = useState("");
  const [unpublishAt, setUnpublishAt] = useState("");
  const [errors, setErrors] = useState<{ publishAt?: string; unpublishAt?: string }>({});
  const [pending, setPending] = useState(false);
  const pendingChanges = doc.status !== "published" || doc.hasUnpublishedChanges;
  const singular = collection.labels.singular.toLowerCase();

  useEffect(() => {
    if (!open) return;
    setPublishAt(toLocalDateTime(doc.publishAt ?? null));
    setUnpublishAt(toLocalDateTime(doc.unpublishAt ?? null));
    setErrors({});
  }, [open, doc.publishAt, doc.unpublishAt]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setErrors({});
    try {
      const result = await services.schedule({
        collection: collection.slug, id: doc.id,
        publishAt: pendingChanges ? fromLocalDateTime(publishAt) : undefined,
        unpublishAt: fromLocalDateTime(unpublishAt),
      });
      if (!result.ok) {
        const next: typeof errors = {};
        for (const issue of result.error.issues ?? []) {
          if (issue.path[0] === "publishAt" || issue.path[0] === "unpublishAt") next[issue.path[0]] = issue.message;
        }
        setErrors(next);
        if (!Object.keys(next).length) toast.error(result.error.message);
        return;
      }
      onSaved(result.data);
      onOpenChange(false);
      toast.success(result.data.publishAt || result.data.unpublishAt ? "Schedule saved" : "Schedule cleared");
    } catch { toast.error("Could not save the schedule. Try again."); }
    finally { setPending(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
    <DialogContent className="xe:sm:max-w-md">
      <form onSubmit={(event) => void save(event)}>
        <DialogHeader>
          <DialogTitle>Schedule</DialogTitle>
          <DialogDescription>Publish or unpublish this {singular} automatically. Times are in your time zone.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="xe:py-5">
          <Field data-invalid={!!errors.publishAt || undefined}>
            <FieldLabel htmlFor="xe-schedule-publish">Publish at</FieldLabel>
            <Input id="xe-schedule-publish" type="datetime-local" value={publishAt} disabled={!pendingChanges || pending}
              aria-invalid={!!errors.publishAt} onChange={(event) => setPublishAt(event.target.value)} />
            {errors.publishAt ? <FieldError>{errors.publishAt}</FieldError> : <FieldDescription>
              {pendingChanges ? `The saved draft goes live then.${dirty ? " Save your latest edits as a draft first to include them." : ""}` : "Save a draft first: there are no unpublished changes to schedule."}
            </FieldDescription>}
          </Field>
          <Field data-invalid={!!errors.unpublishAt || undefined}>
            <FieldLabel htmlFor="xe-schedule-unpublish">Unpublish at</FieldLabel>
            <Input id="xe-schedule-unpublish" type="datetime-local" value={unpublishAt} disabled={pending}
              aria-invalid={!!errors.unpublishAt} onChange={(event) => setUnpublishAt(event.target.value)} />
            {errors.unpublishAt ? <FieldError>{errors.unpublishAt}</FieldError> : <FieldDescription>Readers stop seeing it at this time.</FieldDescription>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          {doc.publishAt || doc.unpublishAt ? <Button type="button" variant="ghost" className="xe:sm:mr-auto" disabled={pending}
            onClick={() => { setPublishAt(""); setUnpublishAt(""); }}>Clear both</Button> : null}
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? <Spinner /> : <RiCalendarScheduleLine data-icon="inline-start" />}Save schedule</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
