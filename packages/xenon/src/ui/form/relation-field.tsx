"use client";

import { useMemo, useState } from "react";
import { RiCloseLine } from "@remixicon/react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "../components/combobox";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import type { DocSummary } from "../shared/services";
import { useDocumentSearch } from "./use-document-search";
import type { FieldInputProps } from "./field-types";

export function RelationField(props: FieldInputProps) {
  const [query, setQuery] = useState("");
  const ids = props.field.hasMany ? Array.isArray(props.value) ? props.value as string[] : [] : typeof props.value === "string" ? [props.value] : [];
  const collection = props.field.relationTo ?? "";
  const search = useDocumentSearch(collection ? { collection, query, limit: 20 } : null);
  const selected = useDocumentSearch(ids.length ? { collection, ids } : null, 0);
  const byId = useMemo(() => new Map([...selected.result.docs, ...search.result.docs].map((doc) => [doc.id, doc])), [selected.result.docs, search.result.docs]);
  const disabled = props.disabled || props.field.admin.readOnly;
  const choose = (doc: DocSummary | null) => {
    if (!doc) return;
    props.onChange(props.field.hasMany ? [...new Set([...ids, doc.id])] : doc.id);
    setQuery("");
  };
  return <div className="xe:flex xe:flex-col xe:gap-2">
    {ids.length ? <div className="xe:flex xe:flex-wrap xe:gap-1.5">{ids.map((id) => <Badge key={id} variant="secondary">
      {byId.get(id)?.title ?? (selected.loading ? "Loading…" : "Unavailable item")}
      {!disabled ? <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${byId.get(id)?.title ?? "item"}`} onClick={() => props.onChange(props.field.hasMany ? ids.filter((value) => value !== id) : null)}><RiCloseLine /></Button> : null}
    </Badge>)}</div> : null}
    <Combobox<DocSummary> items={search.result.docs} value={null} disabled={disabled} inputValue={query} onInputValueChange={(value) => setQuery(value)}
      onValueChange={choose} itemToStringLabel={(item) => item.title} itemToStringValue={(item) => item.id} filter={null}>
      <ComboboxInput id={props.id} aria-labelledby={`${props.id}-label`} aria-invalid={props["aria-invalid"]} aria-describedby={props["aria-describedby"]}
        placeholder={props.field.admin.placeholder ?? "Search for an item…"} disabled={disabled} />
      <ComboboxContent><ComboboxEmpty>{search.loading ? "Searching…" : search.error || "No matching items."}</ComboboxEmpty>
        <ComboboxList>{(item: DocSummary) => <ComboboxItem key={item.id} value={item} disabled={ids.includes(item.id)}>{item.title}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
    {selected.error ? <p role="alert" className="xe:text-xs xe:text-destructive">{selected.error}</p> : null}
  </div>;
}
