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
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { buttonVariants } from "../components/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/empty";
import { Input } from "../components/input";
import { Kbd } from "../components/kbd";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import type { ClientCollection, ClientField } from "../shared/client-config";
import { adminRoutes, type DocSummary } from "../shared/services";
import { StatusBadge, formatDate, timeAgo } from "./format";
import { collectionIcon } from "./shell";

export interface ListRow extends DocSummary {
  values: Record<string, unknown>;
}

export interface CollectionListViewProps {
  collection: ClientCollection;
  rows: ListRow[];
  totalDocs: number;
  page: number;
  totalPages: number;
  query: { q: string; status: string; sort: string };
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
  const { basePath } = useAdmin();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.q);
  const [active, setActive] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  // A long-text field (an excerpt, a summary) reads better as the title's second line than as a column.
  const allColumns = pickColumns(collection);
  const subtitle = allColumns.find((f) => f.type === "textarea") ?? collection.fields.find((f) => f.type === "textarea" && !f.admin.hidden && f.name !== collection.admin.useAsTitle) ?? null;
  const columns = allColumns.filter((f) => f !== subtitle);
  const titleLabel = collection.fields.find((f) => f.name === collection.admin.useAsTitle)?.label ?? "Title";
  const Icon = collectionIcon(collection);

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || (k === "status" && v === "all") || (k === "page" && v === "1")) sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  // Debounced search → URL
  useEffect(() => {
    if (search === query.q) return;
    const t = setTimeout(() => update({ q: search, page: null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Enter" && active >= 0 && rows[active]) {
        router.push(adminRoutes.edit(basePath, collection.slug, rows[active].id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, active, basePath, collection.slug, router]);

  const sortKey = query.sort.replace(/^-/, "");
  const sortDesc = query.sort.startsWith("-");
  const toggleSort = (key: string) => update({ sort: sortKey === key && !sortDesc ? `-${key}` : key, page: null });
  const SortIcon = ({ k }: { k: string }) =>
    sortKey === k ? (sortDesc ? <RiArrowDownSLine className="xe:size-4" /> : <RiArrowUpSLine className="xe:size-4" />) : null;
  const filtered = query.q !== "" || query.status !== "all";
  const newHref = adminRoutes.create(basePath, collection.slug);

  const noun = (n: number) => (collection.upload ? (n === 1 ? "file" : "files") : (n === 1 ? collection.labels.singular : collection.labels.plural).toLowerCase());
  const statusTabs = [
    { value: "all", label: "All" },
    { value: "published", label: "Published" },
    { value: "draft", label: "Drafts" },
  ];

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
        {collection.drafts ? (
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${collection.labels.plural.toLowerCase()}`}
            className="xe:h-8 xe:pr-8 xe:pl-8"
            aria-label="Search"
          />
          <Kbd className="xe:absolute xe:top-4 xe:right-2 xe:-translate-y-1/2">/</Kbd>
        </div>
      </div>

      <div className={cn("xe:transition-opacity", pending && "xe:opacity-60")}>
        {rows.length === 0 ? (
          <div className="xe:rounded-lg xe:border xe:border-dashed xe:border-border">
            <Empty className="xe:py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon />
                </EmptyMedia>
                <EmptyTitle>{filtered ? "No matches" : `No ${collection.labels.plural.toLowerCase()} yet`}</EmptyTitle>
                <EmptyDescription>
                  {filtered
                    ? "Try another search or clear the filters."
                    : collection.upload
                      ? "Upload images and files to use them across your content."
                      : `Create your first ${collection.labels.singular.toLowerCase()} to get started.`}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {filtered ? (
                  <button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => { setSearch(""); update({ q: null, status: null, page: null }); }}>
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
        ) : collection.upload ? (
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
                <TableHead className="xe:h-9 xe:w-auto xe:pl-0 xe:text-xs xe:font-normal xe:text-muted-foreground">
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
                  <button type="button" className="xe:inline-flex xe:items-center xe:gap-1 xe:hover:text-foreground" onClick={() => toggleSort("updatedAt")}>
                    Last edited <SortIcon k="updatedAt" />
                  </button>
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
                    className="xe:relative xe:cursor-pointer xe:border-rule xe:hover:bg-muted/50 xe:data-[state=selected]:bg-accent"
                    onClick={() => router.push(adminRoutes.edit(basePath, collection.slug, row.id))}
                  >
                    <TableCell className="xe:py-2.5 xe:pl-0">
                      <Link href={adminRoutes.edit(basePath, collection.slug, row.id)} className="xe:block xe:truncate xe:font-medium" onClick={(e) => e.stopPropagation()}>
                        {row.title}
                      </Link>
                      {subtitle ? <p className="xe:truncate xe:text-[13px] xe:text-muted-foreground">{typeof sub === "string" && sub ? sub : "—"}</p> : null}
                    </TableCell>
                    {columns.map((f) => (
                      <TableCell key={f.name} className={cn("xe:hidden xe:truncate xe:text-muted-foreground xe:md:table-cell", f.type === "number" && "xe:text-right xe:tabular-nums")}>
                        {renderValue(f, row.values[f.name])}
                      </TableCell>
                    ))}
                    {collection.drafts && (
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                    )}
                    <TableCell className="xe:pr-0 xe:text-right xe:text-[13px] xe:text-muted-foreground" title={formatDate(row.updatedAt)}>
                      <span suppressHydrationWarning>{timeAgo(row.updatedAt)}</span>
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
