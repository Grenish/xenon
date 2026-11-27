"use client";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpSLine,
  RiFileLine,
  RiSearchLine,
} from "@remixicon/react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { buttonVariants } from "../components/button";
import { Checkbox } from "../components/checkbox";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/empty";
import { Input } from "../components/input";
import { Kbd } from "../components/kbd";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import type { ClientCollection, ClientField } from "../shared/client-config";
import { AdminLink as Link, useAdminPathname, useAdminRouter } from "../shared/router";
import { type ListFilter, serializeListFilters } from "../shared/list-filters";
import { type AdminListRow, adminRoutes, type BulkAction, type DocSummary } from "../shared/services";
import { StatusBadge, formatDate, timeAgo } from "./format";
import { DocPeers } from "./presence";
import { BulkBar, ColumnsMenu, columnFields, FilterChips, FilterMenu, type SavedView, useListPrefs, ViewsMenu } from "./list-tools";
import { collectionIcon } from "./shell";

export type ListRow = AdminListRow;

export interface CollectionListViewProps {
  collection: ClientCollection;
  rows: ListRow[];
  totalDocs: number;
  page: number;
  totalPages: number;
  /** `status`: `all`, `published`, `draft` or `trash`. */
  query: { q: string; status: string; sort: string; filter?: ListFilter[] };
}

const SIMPLE: ClientField["type"][] = ["text", "select", "number", "boolean", "textarea"];

function pickColumns(c: ClientCollection): ClientField[] {
  const title = c.admin.useAsTitle;
  const configured = c.admin.defaultColumns
    .map((name) => c.fields.find((f) => f.name === name))
    .filter((f): f is ClientField => !!f && f.name !== title);
  if (configured.length) return configured.slice(0, 4);
  return c.fields.filter((f) => f.name !== title && SIMPLE.includes(f.type) && !f.admin.hidden).slice(0, 2);
}

function renderValue(field: ClientField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "boolean":
      return value ? "Yes" : "No";
    case "select": {
      const label = (v: unknown) => field.options?.find((o) => o.value === v)?.label ?? String(v);
      return Array.isArray(value) ? value.map(label).join(", ") || "—" : label(value);
    }
    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);
    case "date":
      return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? formatDate(value) : String(value);
    case "media":
    case "relation":
      return Array.isArray(value) ? `${value.length} linked` : "1 linked";
    default:
      return typeof value === "string" ? value : JSON.stringify(value);
  }
}

function isImage(row: DocSummary) {
  return !!row.url && (row.mimeType?.startsWith("image/") ?? false);
}

export function CollectionListView({ collection, rows, totalDocs, page, totalPages, query }: CollectionListViewProps) {
  const { basePath, services } = useAdmin();
  const router = useAdminRouter();
  const pathname = useAdminPathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.q);
  const [active, setActive] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submittedSearches = useRef<string[]>([]);
  const prefs = useListPrefs(collection.slug);
  const filters = query.filter ?? [];
  const trashView = query.status === "trash";
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkPending, setBulkPending] = useState<BulkAction | null>(null);
  // A long-text field (an excerpt, a summary) reads better as the title's second line than as a column.
  const allColumns = pickColumns(collection);
  const defaultSubtitle = allColumns.find((f) => f.type === "textarea") ?? collection.fields.find((f) => f.type === "textarea" && !f.admin.hidden && f.name !== collection.admin.useAsTitle) ?? null;
  // Columns chosen in this browser replace the defaults (and the subtitle line).
  const chosen = useMemo(() => (prefs.columns ? columnFields(collection).filter((f) => prefs.columns!.includes(f.name)) : null), [collection, prefs.columns]);
  const subtitle = chosen ? null : defaultSubtitle;
  const columns = chosen ?? allColumns.filter((f) => f !== subtitle);
  const visibleColumnNames = columns.map((f) => f.name).concat(subtitle ? [subtitle.name] : []);
  const titleLabel = collection.fields.find((f) => f.name === collection.admin.useAsTitle)?.label ?? "Title";
  const Icon = collectionIcon(collection);

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(window.location.search);
    if (next.q !== undefined) submittedSearches.current.push(next.q ?? "");
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || (k === "status" && v === "all") || (k === "page" && v === "1")) sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function editSearch(value: string) {
    setSearch(value);
    clearTimeout(searchTimer.current);
    const q = value.trim();
    if (q === query.q && submittedSearches.current.length === 0) return;
    searchTimer.current = setTimeout(() => update({ q, page: null }), 250);
  }

  useEffect(() => {
    // A response to our own search may arrive while the next word is being typed.
    const index = submittedSearches.current.lastIndexOf(query.q);
    if (index >= 0) {
      submittedSearches.current.splice(0, index + 1);
      return;
    }
    clearTimeout(searchTimer.current);
    submittedSearches.current = [];
    setSearch(query.q);
  }, [query.q, collection.slug]);

  useEffect(() => {
    const restore = () => {
      clearTimeout(searchTimer.current);
      submittedSearches.current = [];
      setSearch(new URLSearchParams(window.location.search).get("q")?.trim() ?? "");
    };
    window.addEventListener("popstate", restore);
    return () => {
      clearTimeout(searchTimer.current);
      window.removeEventListener("popstate", restore);
    };
  }, []);

  useEffect(() => { setActive(-1); setSelected(new Set()); }, [rows]);

  const setFilters = (next: ListFilter[]) => update({ filter: serializeListFilters(next), page: null });
  const currentView: Omit<SavedView, "name"> = { status: query.status, sort: query.sort, filter: filters, columns: prefs.columns };
  const applyView = (view: SavedView) => {
    prefs.setColumns(view.columns);
    update({ status: view.status, sort: view.sort === "-updatedAt" ? null : view.sort, filter: serializeListFilters(view.filter), page: null });
  };
  const saveView = (name: string) => {
    prefs.setViews([...prefs.views.filter((v) => v.name !== name), { name, ...currentView }]);
    toast.success(`Saved “${name}”`);
  };

  async function runBulk(action: BulkAction) {
    const ids = [...selected];
    if (!ids.length || bulkPending) return;
    setBulkPending(action);
    try {
      const result = await services.bulk({ collection: collection.slug, ids, action });
      if (!result.ok) { toast.error(result.error.message); return; }
      const { done, failed } = result.data;
      const verb = { publish: "Published", unpublish: "Unpublished", delete: collection.trash ? "Moved to trash:" : "Deleted", restore: "Restored", purge: "Deleted permanently:" }[action];
      if (done.length) toast.success(`${verb} ${done.length} ${noun(done.length)}`);
      if (failed.length) toast.error(`${failed.length} couldn’t be changed`, { description: failed[0]!.message });
      setSelected(new Set(failed.map((f) => f.id)));
    } catch { toast.error("Something went wrong. Try again."); }
    finally { setBulkPending(null); }
  }

  // Keyboard: "/" search, "c" create, j/k move, Enter open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest("input, textarea, [contenteditable], [role=dialog]")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "c") {
        router.push(adminRoutes.create(basePath, collection.slug));
      } else if (e.key === "j" || e.key === "ArrowDown") {
        setActive((a) => Math.min(rows.length - 1, a + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        setActive((a) => rows.length ? Math.max(0, a - 1) : -1);
      } else if (e.key === "Enter" && active >= 0 && rows[active] && query.status !== "trash") {
        router.push(adminRoutes.edit(basePath, collection.slug, rows[active].id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, active, basePath, collection.slug, router, query.status]);

  const sortKey = query.sort.replace(/^-/, "");
  const sortDesc = query.sort.startsWith("-");
  const toggleSort = (key: string) => update({ sort: sortKey === key && !sortDesc ? `-${key}` : key, page: null });
  const SortIcon = ({ k }: { k: string }) =>
    sortKey === k ? (sortDesc ? <RiArrowDownSLine className="xe:size-4" /> : <RiArrowUpSLine className="xe:size-4" />) : null;
  const filtered = query.q !== "" || query.status !== "all" || filters.length > 0;
  const newHref = adminRoutes.create(basePath, collection.slug);

  const noun = (n: number) => (collection.upload ? (n === 1 ? "file" : "files") : (n === 1 ? collection.labels.singular : collection.labels.plural).toLowerCase());
  const statusTabs = [
    { value: "all", label: "All" },
    ...(collection.drafts ? [{ value: "published", label: "Published" }, { value: "draft", label: "Drafts" }] : []),
    ...(collection.trash ? [{ value: "trash", label: "Trash" }] : []),
  ];
  const selectable = !collection.upload || trashView;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string, on: boolean) => setSelected((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });

  return (
    <div className="xe:flex xe:flex-col xe:gap-5">
      <header className="xe:flex xe:flex-wrap xe:items-start xe:justify-between xe:gap-4">
        <div className="xe:flex xe:flex-col xe:gap-1">
          <h1 className="xe:text-[22px] xe:font-semibold xe:leading-tight xe:tracking-[-0.01em]">{collection.labels.plural}</h1>
          <p className="xe:text-sm xe:text-muted-foreground">
            {collection.admin.description ?? `${totalDocs.toLocaleString()} ${noun(totalDocs)}${filtered ? " match" : ""}`}
          </p>
        </div>
        <Link href={newHref} className={cn(buttonVariants(), "xe:gap-1.5")}>
          <RiAddLine className="xe:size-4" /> {collection.upload ? "Upload" : `New ${collection.labels.singular.toLowerCase()}`}
        </Link>
      </header>

      {/* Filters: status as underline tabs on one full-width rule, search at its right end. */}
      <div className="xe:flex xe:flex-col-reverse xe:gap-3 xe:border-b xe:border-border xe:sm:flex-row xe:sm:items-end xe:sm:justify-between">
        {statusTabs.length > 1 ? (
          <div role="tablist" aria-label="Status" className="xe:-mb-px xe:flex xe:gap-5">
            {statusTabs.map((t) => {
              const selected = query.status === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => update({ status: t.value, page: null })}
                  className={cn(
                    "xe:h-10 xe:border-b-2 xe:text-sm xe:transition-colors",
                    selected ? "xe:border-brand xe:font-medium xe:text-foreground" : "xe:border-transparent xe:text-muted-foreground xe:hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : <span />}
        <div className="xe:relative xe:w-full xe:pb-2 xe:sm:w-72">
          <RiSearchLine className="xe:pointer-events-none xe:absolute xe:top-4 xe:left-2.5 xe:size-4 xe:-translate-y-1/2 xe:text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => editSearch(e.target.value)}
            placeholder={`Search ${collection.labels.plural.toLowerCase()}`}
            className="xe:h-8 xe:pr-8 xe:pl-8"
            aria-label="Search"
          />
          <Kbd className="xe:absolute xe:top-4 xe:right-2 xe:-translate-y-1/2">/</Kbd>
        </div>
      </div>

      <div className="xe:flex xe:flex-wrap xe:items-center xe:gap-2">
        <FilterMenu fields={collection.fields} filters={filters} onChange={setFilters} />
        <div className="xe:min-w-0 xe:flex-1"><FilterChips fields={collection.fields} filters={filters} onChange={setFilters} /></div>
        <ViewsMenu views={prefs.views} current={currentView} onApply={applyView} onSave={saveView} onDelete={(name) => prefs.setViews(prefs.views.filter((v) => v.name !== name))} />
        {!collection.upload || trashView ? <ColumnsMenu collection={collection} visible={visibleColumnNames} onChange={prefs.setColumns} /> : null}
      </div>

      {selected.size > 0 ? <BulkBar collection={collection} count={selected.size} trashView={trashView} pending={bulkPending} onRun={(a) => void runBulk(a)} onClear={() => setSelected(new Set())} /> : null}

      <div className={cn("xe:transition-opacity", pending && "xe:opacity-60")}>
        {rows.length === 0 ? (
          <div className="xe:rounded-lg xe:border xe:border-dashed xe:border-border">
            <Empty className="xe:py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon />
                </EmptyMedia>
                <EmptyTitle>{trashView && !query.q && !filters.length ? "The trash is empty" : filtered ? "No matches" : `No ${collection.labels.plural.toLowerCase()} yet`}</EmptyTitle>
                <EmptyDescription>
                  {trashView && !query.q && !filters.length
                    ? "Deleted items wait here until you restore them or delete them permanently."
                    : filtered
                    ? "Try another search or clear the filters."
                    : collection.upload
                      ? "Upload images and files to use them across your content."
                      : `Create your first ${collection.labels.singular.toLowerCase()} to get started.`}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {filtered ? (
                  <button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => { clearTimeout(searchTimer.current); setSearch(""); update({ q: null, status: null, filter: null, page: null }); }}>
                    Clear filters
                  </button>
                ) : (
                  <Link href={newHref} className={buttonVariants()}>
                    <RiAddLine className="xe:size-4" /> {collection.upload ? "Upload a file" : `New ${collection.labels.singular.toLowerCase()}`}
                  </Link>
                )}
              </EmptyContent>
            </Empty>
          </div>
        ) : collection.upload && !trashView ? (
          <ul className="xe:grid xe:grid-cols-2 xe:gap-x-4 xe:gap-y-5 xe:sm:grid-cols-3 xe:lg:grid-cols-4 xe:xl:grid-cols-5">
            {rows.map((row, i) => (
              <li key={row.id}>
                <Link
                  href={adminRoutes.edit(basePath, collection.slug, row.id)}
                  className={cn("xe:group xe:flex xe:flex-col xe:gap-2 xe:rounded-md xe:outline-none", i === active && "xe:ring-2 xe:ring-ring xe:ring-offset-4 xe:ring-offset-background")}
                >
                  <div className="xe:grid xe:aspect-[4/3] xe:place-items-center xe:overflow-hidden xe:rounded-md xe:bg-muted xe:ring-1 xe:ring-border xe:transition-shadow xe:ring-inset xe:group-hover:ring-input">
                    {isImage(row) ? (
                      // biome-ignore lint/a11y/useAltText: decorative thumbnail, the title is right below
                      <img src={row.url!} alt="" loading="lazy" className="xe:size-full xe:object-cover" />
                    ) : (
                      <RiFileLine className="xe:size-8 xe:text-muted-foreground" />
                    )}
                  </div>
                  <div className="xe:min-w-0 xe:px-0.5">
                    <p className="xe:truncate xe:text-sm xe:font-medium xe:group-hover:underline xe:underline-offset-4">{row.title}</p>
                    <p className="xe:truncate xe:text-xs xe:text-muted-foreground">{row.filename ?? row.mimeType}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Table className="xe:table-fixed">
            <TableHeader className="xe:[&_tr]:border-b-0">
              <TableRow className="xe:hover:bg-transparent">
                {selectable ? <TableHead className="xe:h-9 xe:w-8 xe:pl-0">
                  <Checkbox aria-label="Select all on this page" checked={allSelected} indeterminate={!allSelected && rows.some((r) => selected.has(r.id))}
                    onCheckedChange={(on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())} />
                </TableHead> : null}
                <TableHead className={cn("xe:h-9 xe:w-auto xe:text-xs xe:font-normal xe:text-muted-foreground", !selectable && "xe:pl-0")}>
                  <button type="button" className="xe:inline-flex xe:items-center xe:gap-1 xe:hover:text-foreground" onClick={() => collection.admin.useAsTitle && toggleSort(collection.admin.useAsTitle)}>
                    {titleLabel} <SortIcon k={collection.admin.useAsTitle ?? ""} />
                  </button>
                </TableHead>
                {columns.map((f) => (
                  <TableHead key={f.name} className={cn("xe:hidden xe:h-9 xe:w-36 xe:text-xs xe:font-normal xe:text-muted-foreground xe:md:table-cell", f.type === "number" && "xe:text-right")}>
                    {f.label}
                  </TableHead>
                ))}
                {collection.drafts && <TableHead className="xe:h-9 xe:w-40 xe:text-xs xe:font-normal xe:text-muted-foreground">Status</TableHead>}
                <TableHead className="xe:h-9 xe:w-32 xe:pr-0 xe:text-right xe:text-xs xe:font-normal xe:text-muted-foreground">
                  {trashView ? "Deleted" : <button type="button" className="xe:inline-flex xe:items-center xe:gap-1 xe:hover:text-foreground" onClick={() => toggleSort("updatedAt")}>
                    Last edited <SortIcon k="updatedAt" />
                  </button>}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                const sub = subtitle ? row.values[subtitle.name] : null;
                return (
                  <TableRow
                    key={row.id}
                    data-state={i === active ? "selected" : undefined}
                    aria-selected={selectable ? selected.has(row.id) : undefined}
                    className={cn("xe:relative xe:border-rule xe:hover:bg-muted/50 xe:data-[state=selected]:bg-accent", !trashView && "xe:cursor-pointer")}
                    onClick={() => { if (!trashView) router.push(adminRoutes.edit(basePath, collection.slug, row.id)); }}
                  >
                    {selectable ? <TableCell className="xe:w-8 xe:py-2.5 xe:pl-0" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={`Select ${row.title}`} checked={selected.has(row.id)} onCheckedChange={(on) => toggle(row.id, on)} />
                    </TableCell> : null}
                    <TableCell className={cn("xe:py-2.5", !selectable && "xe:pl-0")}>
                      <span className="xe:flex xe:min-w-0 xe:items-center xe:gap-2">
                        {trashView ? <span className="xe:truncate xe:font-medium">{row.title}</span> : <Link href={adminRoutes.edit(basePath, collection.slug, row.id)} className="xe:truncate xe:font-medium" onClick={(e) => e.stopPropagation()}>
                          {row.title}
                        </Link>}
                        <DocPeers collection={collection.slug} id={row.id} />
                      </span>
                      {subtitle ? <p className="xe:truncate xe:text-[13px] xe:text-muted-foreground">{typeof sub === "string" && sub ? sub : "—"}</p> : null}
                    </TableCell>
                    {columns.map((f) => (
                      <TableCell key={f.name} className={cn("xe:hidden xe:truncate xe:text-muted-foreground xe:md:table-cell", f.type === "number" && "xe:text-right xe:tabular-nums")}>
                        {renderValue(f, row.values[f.name])}
                      </TableCell>
                    ))}
                    {collection.drafts && (
                      <TableCell>
                        <StatusBadge status={row.status} changed={row.changed} />
                      </TableCell>
                    )}
                    <TableCell className="xe:pr-0 xe:text-right xe:text-[13px] xe:text-muted-foreground" title={formatDate(row.deletedAt ?? row.updatedAt)}>
                      <span suppressHydrationWarning>{timeAgo(row.deletedAt ?? row.updatedAt)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {totalPages > 1 && (
        <nav className="xe:flex xe:items-center xe:justify-between xe:text-sm xe:text-muted-foreground" aria-label="Pagination">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="xe:flex xe:gap-2">
            <button type="button" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <RiArrowLeftSLine className="xe:size-4" /> Previous
            </button>
            <button type="button" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Next <RiArrowRightSLine className="xe:size-4" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
