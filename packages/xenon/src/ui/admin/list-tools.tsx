"use client";
/**
 * Collection list tools (#18): filter menu and chips, column chooser, saved views and the bulk
 * action bar. Filters travel in the URL; columns and saved views are kept per browser.
 */
import { useEffect, useMemo, useState } from "react";
import { RiAddLine, RiBookmarkLine, RiCloseLine, RiDeleteBinLine, RiEyeOffLine, RiFilter3Line, RiLayoutColumnLine, RiRestartLine, RiUploadCloud2Line } from "@remixicon/react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/alert-dialog";
import { Button } from "../components/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/dropdown-menu";
import { Input } from "../components/input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/select";
import { Spinner } from "../components/spinner";
import type { ClientCollection, ClientField } from "../shared/client-config";
import { FILTER_OP_LABEL, type FilterOp, filterableFields, filterOps, type ListFilter } from "../shared/list-filters";
import type { BulkAction } from "../shared/services";

/* ------------------------------- preferences ------------------------------- */

/** Field types a list column can show. */
const COLUMN_TYPES: ClientField["type"][] = ["text", "textarea", "select", "number", "boolean", "date", "email", "url", "relation", "media"];

export function columnFields(collection: ClientCollection): ClientField[] {
  return collection.fields.filter((f) => f.name !== collection.admin.useAsTitle && !f.admin.hidden && COLUMN_TYPES.includes(f.type));
}

export interface SavedView {
  name: string;
  status: string;
  sort: string;
  filter: ListFilter[];
  /** `null`: the collection's default columns. */
  columns: string[] | null;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* Private mode or storage full: the choice lasts for this page only. */ }
}

/** Per-browser list preferences of one collection: chosen columns and saved views. */
export function useListPrefs(collection: string) {
  const columnsKey = `xenon:list:${collection}:columns`;
  const viewsKey = `xenon:list:${collection}:views`;
  const [columns, setColumnsState] = useState<string[] | null>(null);
  const [views, setViewsState] = useState<SavedView[]>([]);
  // Read after mount so server and first client render agree.
  useEffect(() => {
    const stored = readJson<unknown>(columnsKey, null);
    setColumnsState(Array.isArray(stored) && stored.every((c) => typeof c === "string") ? stored : null);
    const savedViews = readJson<unknown>(viewsKey, []);
    setViewsState(Array.isArray(savedViews) ? (savedViews as SavedView[]).filter((v) => v && typeof v.name === "string") : []);
  }, [columnsKey, viewsKey]);
  return {
    columns,
    setColumns(next: string[] | null) { setColumnsState(next); writeJson(columnsKey, next); },
    views,
    setViews(next: SavedView[]) { setViewsState(next); writeJson(viewsKey, next.length ? next : null); },
  };
}

/* ---------------------------------- filters ---------------------------------- */

function describeValue(field: ClientField, value: ListFilter["value"]): string {
  if (value === undefined) return "";
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (field.type === "select") return field.options?.find((o) => o.value === value)?.label ?? String(value);
  if (field.type === "date" && typeof value === "string") return new Date(value).toLocaleDateString();
  return String(value);
}

export function describeFilter(fields: readonly ClientField[], filter: ListFilter): string {
  const field = fields.find((f) => f.name === filter.field);
  if (!field) return filter.field;
  const value = describeValue(field, filter.value);
  return `${field.label} ${FILTER_OP_LABEL[filter.op]}${value ? ` ${value}` : ""}`;
}

export function FilterChips({ fields, filters, onChange }: { fields: readonly ClientField[]; filters: ListFilter[]; onChange(next: ListFilter[]): void }) {
  if (!filters.length) return null;
  return <ul aria-label="Filters" className="xe:flex xe:flex-wrap xe:items-center xe:gap-1.5">
    {filters.map((filter, i) => (
      <li key={`${filter.field}-${filter.op}-${i}`} className="xe:flex xe:h-7 xe:items-center xe:gap-1 xe:rounded-full xe:border xe:border-border xe:bg-muted/60 xe:pr-1 xe:pl-3 xe:text-[13px]">
        <span className="xe:max-w-64 xe:truncate">{describeFilter(fields, filter)}</span>
        <button type="button" aria-label={`Remove filter: ${describeFilter(fields, filter)}`} onClick={() => onChange(filters.filter((_, j) => j !== i))}
          className="xe:grid xe:size-5 xe:place-items-center xe:rounded-full xe:text-muted-foreground xe:hover:bg-background xe:hover:text-foreground">
          <RiCloseLine className="xe:size-3.5" />
        </button>
      </li>
    ))}
    <li><Button type="button" variant="ghost" size="xs" onClick={() => onChange([])}>Clear all</Button></li>
  </ul>;
}

export function FilterMenu({ fields, filters, onChange }: { fields: readonly ClientField[]; filters: ListFilter[]; onChange(next: ListFilter[]): void }) {
  const options = useMemo(() => filterableFields(fields), [fields]);
  const [open, setOpen] = useState(false);
  const [fieldName, setFieldName] = useState<string | null>(null);
  const [op, setOp] = useState<FilterOp | null>(null);
  const [value, setValue] = useState("");
  const field = options.find((f) => f.name === fieldName) ?? null;
  const ops = field ? filterOps(field) : [];
  const needsValue = op !== null && op !== "exists" && op !== "not_exists";

  useEffect(() => {
    if (!open) return;
    const first = options[0] ?? null;
    setFieldName(first?.name ?? null);
    setOp(first ? filterOps(first)[0] ?? null : null);
    setValue("");
  }, [open, options]);

  if (!options.length) return null;

  function pickField(name: string | null) {
    const next = options.find((f) => f.name === name) ?? null;
    setFieldName(next?.name ?? null);
    setOp(next ? filterOps(next)[0] ?? null : null);
    setValue(next?.type === "boolean" ? "true" : "");
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    if (!field || !op || (needsValue && value === "")) return;
    const filter: ListFilter = { field: field.name, op };
    if (needsValue) filter.value = field.type === "number" ? Number(value) : field.type === "boolean" ? value === "true" : field.type === "date" ? new Date(value).toISOString() : value;
    onChange([...filters, filter]);
    setOpen(false);
  }

  const fieldItems = options.map((f) => ({ value: f.name, label: f.label }));
  const opItems = ops.map((o) => ({ value: o, label: FILTER_OP_LABEL[o] }));
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="outline" size="sm" disabled={filters.length >= 10} />}><RiFilter3Line data-icon="inline-start" />Filter</PopoverTrigger>
    <PopoverContent align="start" className="xe:w-80 xe:p-3">
      <form onSubmit={add} className="xe:flex xe:flex-col xe:gap-2">
        <p className="xe:text-xs xe:font-medium xe:text-muted-foreground">Show only items where</p>
        <Select items={fieldItems} value={fieldName} onValueChange={(v) => pickField(v as string | null)}>
          <SelectTrigger aria-label="Field" className="xe:w-full"><SelectValue /></SelectTrigger>
          <SelectContent alignItemWithTrigger={false}><SelectGroup>{fieldItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <Select items={opItems} value={op} onValueChange={(v) => setOp(v as FilterOp)}>
          <SelectTrigger aria-label="Condition" className="xe:w-full"><SelectValue /></SelectTrigger>
          <SelectContent alignItemWithTrigger={false}><SelectGroup>{opItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        {needsValue && field ? <FilterValueInput field={field} value={value} onChange={setValue} /> : null}
        <Button type="submit" size="sm" className="xe:mt-1 xe:self-end" disabled={!field || !op || (needsValue && value === "")}><RiAddLine data-icon="inline-start" />Add filter</Button>
      </form>
    </PopoverContent>
  </Popover>;
}

function FilterValueInput({ field, value, onChange }: { field: ClientField; value: string; onChange(value: string): void }) {
  if (field.type === "select" || field.type === "boolean") {
    const items = field.type === "boolean" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : (field.options ?? []).map((o) => ({ value: o.value, label: o.label }));
    return <Select items={items} value={value || null} onValueChange={(v) => onChange((v as string | null) ?? "")}>
      <SelectTrigger aria-label="Value" className="xe:w-full"><SelectValue placeholder="Choose a value" /></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}><SelectGroup>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>;
  }
  return <Input aria-label="Value" autoFocus value={value} onChange={(e) => onChange(e.target.value)}
    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} placeholder="Value" />;
}

/* ---------------------------------- columns ---------------------------------- */

export function ColumnsMenu({ collection, visible, onChange }: { collection: ClientCollection; visible: string[]; onChange(next: string[] | null): void }) {
  const fields = columnFields(collection);
  if (!fields.length) return null;
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}><RiLayoutColumnLine data-icon="inline-start" />Columns</DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="xe:w-56">
      <DropdownMenuGroup>
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        {fields.map((f) => (
          <DropdownMenuCheckboxItem key={f.name} checked={visible.includes(f.name)} closeOnClick={false}
            onCheckedChange={(checked) => onChange(fields.map((x) => x.name).filter((n) => (n === f.name ? checked : visible.includes(n))))}>
            {f.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onChange(null)}><RiRestartLine />Reset to default</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/* ----------------------------------- views ----------------------------------- */

export function ViewsMenu({ views, current, onApply, onSave, onDelete }: {
  views: SavedView[];
  current: Omit<SavedView, "name">;
  onApply(view: SavedView): void;
  onSave(name: string): void;
  onDelete(name: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const same = (v: SavedView) => v.status === current.status && v.sort === current.sort && JSON.stringify(v.filter) === JSON.stringify(current.filter) && JSON.stringify(v.columns) === JSON.stringify(current.columns);
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setName(""); }}>
    <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}><RiBookmarkLine data-icon="inline-start" />Views</PopoverTrigger>
    <PopoverContent align="end" className="xe:w-72 xe:gap-0 xe:p-1.5">
      <p className="xe:px-2 xe:pt-1 xe:pb-1.5 xe:text-xs xe:text-muted-foreground">Saved views</p>
      {views.length === 0 ? <p className="xe:px-2 xe:pb-2 xe:text-[13px] xe:text-muted-foreground">Save filters, sorting and columns to come back to them.</p> : null}
      <ul className="xe:flex xe:flex-col">
        {views.map((view) => (
          <li key={view.name} className="xe:group xe:flex xe:items-center xe:rounded-md xe:hover:bg-muted">
            <button type="button" aria-current={same(view) ? "true" : undefined} onClick={() => { onApply(view); setOpen(false); }}
              className="xe:flex-1 xe:truncate xe:px-2 xe:py-1.5 xe:text-left xe:text-[13px] xe:aria-[current]:font-medium">{view.name}</button>
            <button type="button" aria-label={`Delete view ${view.name}`} onClick={() => onDelete(view.name)}
              className="xe:mr-1 xe:grid xe:size-6 xe:place-items-center xe:rounded xe:text-muted-foreground xe:opacity-0 xe:group-hover:opacity-100 xe:focus-visible:opacity-100 xe:hover:text-destructive">
              <RiDeleteBinLine className="xe:size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form className="xe:mt-1.5 xe:flex xe:gap-1.5 xe:border-t xe:border-border xe:px-1 xe:pt-2 xe:pb-0.5"
        onSubmit={(event) => { event.preventDefault(); const n = name.trim(); if (n) { onSave(n); setName(""); } }}>
        <Input aria-label="Name for the current view" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Save current view as…" className="xe:h-7" />
        <Button type="submit" size="sm" disabled={!name.trim()}>Save</Button>
      </form>
    </PopoverContent>
  </Popover>;
}

/* ------------------------------------ bulk ------------------------------------ */

const BULK_COPY: Record<BulkAction, { label: string; confirm?: (n: number, noun: string) => { title: string; body: string; action: string } }> = {
  publish: { label: "Publish" },
  unpublish: { label: "Unpublish" },
  restore: { label: "Restore" },
  delete: {
    label: "Delete",
    confirm: (n, noun) => ({ title: `Delete ${n} ${noun}?`, body: "They will be permanently deleted. This can’t be undone.", action: "Delete permanently" }),
  },
  purge: {
    label: "Delete permanently",
    confirm: (n, noun) => ({ title: `Delete ${n} ${noun} permanently?`, body: "They will be removed from the trash for good, with their files and history. This can’t be undone.", action: "Delete permanently" }),
  },
};

export function BulkBar({ collection, count, trashView, pending, onRun, onClear }: {
  collection: ClientCollection;
  count: number;
  trashView: boolean;
  pending: BulkAction | null;
  onRun(action: BulkAction): void;
  onClear(): void;
}) {
  const [confirm, setConfirm] = useState<BulkAction | null>(null);
  const noun = (count === 1 ? collection.labels.singular : collection.labels.plural).toLowerCase();
  const actions: BulkAction[] = trashView ? ["restore", "purge"] : [...(collection.drafts ? (["publish", "unpublish"] as const) : []), "delete"];
  const run = (action: BulkAction) => (BULK_COPY[action].confirm && !(action === "delete" && collection.trash) ? setConfirm(action) : onRun(action));
  const copy = confirm ? BULK_COPY[confirm].confirm!(count, noun) : null;
  const icon = (action: BulkAction) => action === "publish" ? <RiUploadCloud2Line data-icon="inline-start" /> : action === "unpublish" ? <RiEyeOffLine data-icon="inline-start" />
    : action === "restore" ? <RiRestartLine data-icon="inline-start" /> : <RiDeleteBinLine data-icon="inline-start" />;
  return <>
    <div role="toolbar" aria-label="Bulk actions" className="xe:flex xe:flex-wrap xe:items-center xe:gap-2 xe:rounded-lg xe:border xe:border-border xe:bg-muted/60 xe:px-3 xe:py-2">
      <p className="xe:mr-auto xe:text-[13px] xe:font-medium" aria-live="polite">{count} selected</p>
      {actions.map((action) => (
        <Button key={action} type="button" size="sm" variant={action === "delete" || action === "purge" ? "destructive" : "outline"} disabled={!!pending} onClick={() => run(action)}>
          {pending === action ? <Spinner /> : icon(action)}{action === "delete" && collection.trash ? "Move to trash" : BULK_COPY[action].label}
        </Button>
      ))}
      <Button type="button" size="sm" variant="ghost" disabled={!!pending} onClick={onClear}>Clear</Button>
    </div>
    <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
      <AlertDialogDescription>{copy?.body}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction variant="destructive" onClick={() => { const action = confirm; setConfirm(null); if (action) onRun(action); }}>{copy?.action}</AlertDialogAction>
    </AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
