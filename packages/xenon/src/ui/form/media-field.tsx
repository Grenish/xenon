"use client";

import { useRef, useState } from "react";
import { RiArrowDownLine, RiArrowUpLine, RiCloseLine, RiFileLine, RiImageAddLine } from "@remixicon/react";
import { Button } from "../components/button";
import { useDocumentSearch } from "./use-document-search";
import { MediaPicker } from "./media-picker";
import type { DocSummary } from "../shared/services";
import type { FieldInputProps } from "./field-types";

/**
 * Keeps every currently selected media ID (in order) even while summaries are still loading or if
 * one item fails to resolve, so opening the picker in `hasMany` mode never wipes existing IDs.
 */
export function resolveSelectedMedia(ids: readonly string[], docs: readonly DocSummary[], loading = false): DocSummary[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  return ids.map((id) => byId.get(id) ?? {
    id,
    title: loading ? "Loading…" : "Unavailable file",
    status: "published",
    updatedAt: "",
  });
}

export function MediaField(props: FieldInputProps) {
  const [open, setOpen] = useState(false);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const collection = props.field.relationTo ?? "";
  const ids = props.field.hasMany ? Array.isArray(props.value) ? props.value as string[] : [] : typeof props.value === "string" ? [props.value] : [];
  const selected = useDocumentSearch(ids.length ? { collection, ids } : null, 0);
  const selectedSummaries = resolveSelectedMedia(ids, selected.result.docs, selected.loading);
  const disabled = props.disabled || props.field.admin.readOnly;
  function reorder(index: number, step: number) {
    const next = [...ids];
    [next[index], next[index + step]] = [next[index + step]!, next[index]!];
    props.onChange(next);
  }
  return <div className="xe:flex xe:flex-col xe:gap-3" aria-describedby={props["aria-describedby"]}>
    {ids.length ? <div className="xe:flex xe:flex-col xe:gap-2">{ids.map((id, index) => {
      const doc = selected.result.docs.find((item) => item.id === id);
      return <div key={id} className="xe:flex xe:items-center xe:gap-3 xe:rounded-lg xe:border xe:border-border xe:bg-card xe:p-2">
        <div className="xe:flex xe:size-14 xe:shrink-0 xe:items-center xe:justify-center xe:overflow-hidden xe:rounded-md xe:bg-muted">{doc?.url && doc.mimeType?.startsWith("image/") ? <img src={doc.url} alt={doc.title} className="xe:size-full xe:object-cover" /> : <RiFileLine className="xe:size-5 xe:text-muted-foreground" />}</div>
        <div className="xe:min-w-0 xe:flex-1"><p className="xe:truncate xe:text-sm xe:font-medium">{doc?.title ?? (selected.loading ? "Loading…" : "Unavailable file")}</p><p className="xe:truncate xe:text-xs xe:text-muted-foreground">{doc?.filename}</p></div>
        {!disabled ? <div className="xe:flex xe:shrink-0 xe:gap-0.5">{props.field.hasMany ? <><Button type="button" size="icon-xs" variant="ghost" disabled={index === 0} aria-label="Move file up" onClick={() => reorder(index, -1)}><RiArrowUpLine /></Button><Button type="button" size="icon-xs" variant="ghost" disabled={index === ids.length - 1} aria-label="Move file down" onClick={() => reorder(index, 1)}><RiArrowDownLine /></Button></> : null}
          <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove ${doc?.title ?? "file"}`} onClick={() => props.onChange(props.field.hasMany ? ids.filter((item) => item !== id) : null)}><RiCloseLine /></Button></div> : null}
      </div>;
    })}</div> : <div className="xe:flex xe:items-center xe:gap-3 xe:rounded-lg xe:border xe:border-dashed xe:border-input xe:p-4"><RiImageAddLine className="xe:size-6 xe:text-muted-foreground" /><p className="xe:text-sm xe:text-muted-foreground">Choose a file from your media library.</p></div>}
    <Button ref={chooseButton} id={props.id} type="button" variant="outline" className="xe:self-start" disabled={disabled || !collection} aria-invalid={props["aria-invalid"]} onClick={() => setOpen(true)}>{ids.length ? "Change selection" : "Choose media"}</Button>
    {selected.error ? <p role="alert" className="xe:text-xs xe:text-destructive">{selected.error}</p> : null}
    <MediaPicker returnFocus={chooseButton} open={open} onOpenChange={setOpen} collection={collection} multiple={props.field.hasMany} selected={selectedSummaries}
      onChoose={(docs) => props.onChange(props.field.hasMany ? docs.map((doc) => doc.id) : docs[0]?.id ?? null)} />
  </div>;
}
