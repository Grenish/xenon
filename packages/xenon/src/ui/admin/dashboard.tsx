"use client";
import { RiAddLine, RiArrowDownSLine, RiArrowRightLine, RiImageLine } from "@remixicon/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "../components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "../components/dropdown-menu";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import type { ClientCollection } from "../shared/client-config";
import { adminRoutes, type DashboardData, type DashboardDoc } from "../shared/services";
import { StatusBadge, formatDate, timeAgo } from "./format";
import { DocPeers } from "./presence";
import { collectionIcon } from "./shell";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/* The three publication states, drawn the same way in the strip, the bars and the legend. */
const STATE = {
  live: { label: "Live", swatch: "xe:bg-brand" },
  changed: { label: "Live, with changes", swatch: "xe:bg-warning" },
  draft: { label: "Drafts", swatch: "xe:bg-input" },
} as const;

/**
 * Overview. The screen's question: "what is waiting to be published?" The pipeline answers it with
 * the state of every document; the queue beside it is where the work starts.
 */
export function DashboardView({ data }: { data: DashboardData }) {
  const { collections } = useAdmin();
  const bySlug = useMemo(() => new Map(collections.map((c) => [c.slug, c])), [collections]);
  const content = data.collections.filter((s) => !bySlug.get(s.slug)?.upload);
  const uploads = data.collections.filter((s) => bySlug.get(s.slug)?.upload);
  const sum = (key: "published" | "drafts" | "changed" | "total") => content.reduce((n, s) => n + s[key], 0);
  const media = uploads.reduce((acc, s) => ({ count: acc.count + s.total, bytes: acc.bytes + (s.bytes ?? 0) }), { count: 0, bytes: 0 });
  const hasDrafts = content.some((s) => bySlug.get(s.slug)?.drafts);
  const drafts = sum("drafts");
  const changed = sum("changed");

  const finding = !hasDrafts
    ? `${plural(sum("total"), "document")} across ${plural(content.length, "collection")}.`
    : drafts + changed === 0
      ? "Everything is published and up to date."
      : [drafts ? `${plural(drafts, "draft")}` : "", changed ? `${plural(changed, "live document")} with unpublished changes` : ""].filter(Boolean).join(" and ") +
        ` ${drafts + changed === 1 ? "is" : "are"} waiting for review.`;

  return (
    <div className="xe:flex xe:flex-col xe:gap-6">
      <header className="xe:flex xe:flex-wrap xe:items-start xe:justify-between xe:gap-4">
        <div className="xe:flex xe:flex-col xe:gap-1">
          <h1 className="xe:text-[22px] xe:font-semibold xe:leading-tight xe:tracking-[-0.01em]">Overview</h1>
          <p className="xe:text-sm xe:text-muted-foreground">{finding}</p>
        </div>
        <NewMenu collections={collections} />
      </header>

      <Pipeline content={content} bySlug={bySlug} hasDrafts={hasDrafts} media={uploads.length ? media : null} totals={{ live: sum("published") - changed, changed, drafts, total: sum("total") }} />

      <div className="xe:grid xe:gap-6 xe:lg:grid-cols-3">
        <Panel
          className="xe:lg:col-span-2"
          title="Waiting to publish"
          meta={hasDrafts ? (data.attentionTotal ? `${plural(data.attentionTotal, "document")}, oldest first` : undefined) : "Drafts are off for every collection"}
        >
          {data.attention.length ? (
            <DocRows docs={data.attention.slice(0, 5)} bySlug={bySlug} action="Review" />
          ) : (
            <EmptyRow>{hasDrafts ? "Nothing is waiting. Every draft has been published." : "Turn on drafts in a collection to review changes before they go live."}</EmptyRow>
          )}
        </Panel>
        <Activity days={data.activity.days} edited={data.activity.edited} created={data.activity.created} />
      </div>

      <div className="xe:grid xe:gap-6 xe:lg:grid-cols-3">
        <Panel className="xe:lg:col-span-2" title="Recently edited" meta="Across every collection">
          {data.recent.length ? <DocRows docs={data.recent.slice(0, 6)} bySlug={bySlug} /> : <EmptyRow>Nothing here yet. Create your first document to get started.</EmptyRow>}
        </Panel>
        {uploads.length ? <MediaPanel data={data} bySlug={bySlug} count={media.count} bytes={media.bytes} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function NewMenu({ collections }: { collections: ClientCollection[] }) {
  const { basePath } = useAdmin();
  const router = useRouter();
  if (collections.length === 1) {
    const c = collections[0]!;
    return <Button onClick={() => router.push(adminRoutes.create(basePath, c.slug))}><RiAddLine data-icon="inline-start" />New {c.labels.singular.toLowerCase()}</Button>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}><RiAddLine data-icon="inline-start" />New<RiArrowDownSLine data-icon="inline-end" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="xe:w-48">
        <DropdownMenuGroup>
          {collections.map((c) => {
            const Icon = collectionIcon(c);
            return <DropdownMenuItem key={c.slug} onClick={() => router.push(adminRoutes.create(basePath, c.slug))}><Icon />{c.upload ? `Upload to ${c.labels.plural.toLowerCase()}` : c.labels.singular}</DropdownMenuItem>;
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Panel({ title, meta, action, children, className }: { title: string; meta?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("xe:flex xe:min-w-0 xe:flex-col xe:rounded-lg xe:border xe:border-border xe:bg-card", className)}>
      <header className="xe:flex xe:min-h-13 xe:items-center xe:justify-between xe:gap-4 xe:px-5 xe:pt-4 xe:pb-3">
        <div className="xe:flex xe:min-w-0 xe:items-baseline xe:gap-3">
          <h2 className="xe:shrink-0 xe:text-[15px] xe:font-semibold">{title}</h2>
          {meta ? <p className="xe:truncate xe:text-[13px] xe:text-muted-foreground">{meta}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="xe:px-5 xe:pb-5">
      <p className="xe:rounded-md xe:border xe:border-dashed xe:border-border xe:px-4 xe:py-3 xe:text-sm xe:text-muted-foreground">{children}</p>
    </div>
  );
}

/** The signature block: every content collection as one bar split by publication state. */
function Pipeline({ content, bySlug, hasDrafts, media, totals }: {
  content: DashboardData["collections"];
  bySlug: Map<string, ClientCollection>;
  hasDrafts: boolean;
  media: { count: number; bytes: number } | null;
  totals: { live: number; changed: number; drafts: number; total: number };
}) {
  const { basePath } = useAdmin();
  const cells: { key: string; label: string; value: number; note: string; swatch?: string }[] = hasDrafts
    ? [
        { key: "live", label: STATE.live.label, value: totals.live, note: "published, up to date", swatch: STATE.live.swatch },
        { key: "changed", label: STATE.changed.label, value: totals.changed, note: "edits not yet published", swatch: STATE.changed.swatch },
        { key: "draft", label: STATE.draft.label, value: totals.drafts, note: "never published", swatch: STATE.draft.swatch },
      ]
    : [{ key: "total", label: "Documents", value: totals.total, note: `across ${plural(content.length, "collection")}` }];
  if (media) cells.push({ key: "media", label: "Media files", value: media.count, note: `${formatBytes(media.bytes)} stored` });

  return (
    <section aria-labelledby="xe-pipeline" className="xe:rounded-lg xe:border xe:border-border xe:bg-card">
      <h2 id="xe-pipeline" className="xe:sr-only">Publishing</h2>
      <dl className={cn("xe:grid xe:grid-cols-2 xe:border-b xe:border-border", cells.length === 4 ? "xe:md:grid-cols-4" : cells.length === 3 ? "xe:md:grid-cols-3" : "")}>
        {cells.map((cell, i) => (
          <div
            key={cell.key}
            className={cn(
              "xe:flex xe:flex-col xe:gap-1 xe:px-5 xe:py-4",
              i > 0 && "xe:md:border-l xe:md:border-border",
              i % 2 === 1 && "xe:border-l xe:border-border",
              i >= 2 && "xe:border-t xe:border-border xe:md:border-t-0",
              cells.length % 2 === 1 && i === cells.length - 1 && "xe:col-span-2 xe:md:col-span-1",
            )}
          >
            <dt className="xe:flex xe:items-center xe:gap-2 xe:text-[13px] xe:font-medium xe:text-foreground">
              {cell.swatch ? <span aria-hidden className={cn("xe:size-2 xe:rounded-[2px]", cell.swatch)} /> : null}
              {cell.label}
            </dt>
            <dd className="xe:flex xe:items-baseline xe:gap-2">
              <span className={cn("xe:text-[28px] xe:leading-tight xe:tabular-nums xe:tracking-[-0.01em]", cell.value === 0 && "xe:text-muted-foreground")}>{cell.value.toLocaleString()}</span>
              <span className="xe:text-[13px] xe:text-muted-foreground">{cell.note}</span>
            </dd>
          </div>
        ))}
      </dl>
      <ul className="xe:flex xe:flex-col xe:gap-1 xe:px-5 xe:py-3">
        {content.map((s) => {
          const c = bySlug.get(s.slug);
          if (!c) return null;
          const live = s.published - s.changed;
          const parts = c.drafts
            ? [{ n: live, ...STATE.live }, { n: s.changed, ...STATE.changed }, { n: s.drafts, ...STATE.draft }]
            : [{ n: s.total, ...STATE.live }];
          const summary = c.drafts ? `${live} live, ${s.changed} live with changes, ${s.drafts} drafts` : plural(s.total, "document");
          return (
            <li key={s.slug} className="xe:grid xe:grid-cols-[minmax(0,1fr)_auto] xe:items-center xe:gap-x-4 xe:gap-y-2 xe:py-1.5 xe:md:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto]">
              <Link href={adminRoutes.list(basePath, s.slug)} className="xe:truncate xe:text-sm xe:font-medium xe:hover:underline xe:underline-offset-4">{c.labels.plural}</Link>
              <div role="img" aria-label={summary} className="xe:order-last xe:col-span-2 xe:flex xe:h-2.5 xe:gap-[2px] xe:overflow-hidden xe:rounded-full xe:bg-muted xe:md:order-none xe:md:col-span-1">
                {s.total ? parts.filter((p) => p.n > 0).map((p) => (
                  <span key={p.label} title={`${p.label}: ${p.n}`} className={cn("xe:h-full", p.swatch)} style={{ width: `${(p.n / s.total) * 100}%` }} />
                )) : null}
              </div>
              <span className="xe:text-right xe:text-[13px] xe:tabular-nums xe:text-muted-foreground xe:md:w-24">{s.total ? plural(s.total, "doc") : "Empty"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DocRows({ docs, bySlug, action }: { docs: DashboardDoc[]; bySlug: Map<string, ClientCollection>; action?: string }) {
  const { basePath } = useAdmin();
  return (
    <ul className="xe:border-t xe:border-rule">
      {docs.map((d) => {
        const c = bySlug.get(d.collection);
        const showStatus = c?.drafts && !c.upload;
        return (
          <li key={`${d.collection}:${d.id}`} className="xe:border-b xe:border-rule xe:last:border-b-0">
            <Link href={adminRoutes.edit(basePath, d.collection, d.id)} className="xe:group xe:grid xe:grid-cols-[minmax(0,1fr)_auto] xe:items-center xe:gap-4 xe:px-5 xe:py-2.5 xe:transition-colors xe:hover:bg-muted/60 xe:focus-visible:bg-muted/60 xe:sm:grid-cols-[minmax(0,1fr)_auto_6.5rem]">
              <span className="xe:min-w-0">
                <span className="xe:flex xe:min-w-0 xe:items-center xe:gap-2"><span className="xe:truncate xe:text-sm xe:font-medium">{d.title}</span><DocPeers collection={d.collection} id={d.id} /></span>
                <span className="xe:block xe:truncate xe:text-xs xe:text-muted-foreground">
                  {c?.labels.singular ?? d.collection} · <time dateTime={d.updatedAt} title={formatDate(d.updatedAt)} suppressHydrationWarning>edited {timeAgo(d.updatedAt)}</time>
                </span>
              </span>
              {showStatus ? <StatusBadge status={d.status} changed={d.changed} /> : <span />}
              <span className="xe:hidden xe:items-center xe:justify-end xe:gap-1 xe:text-[13px] xe:font-medium xe:text-foreground xe:sm:flex">
                {action ? <>{action}<RiArrowRightLine className="xe:size-3.5 xe:transition-transform xe:group-hover:translate-x-0.5" aria-hidden /></> : (
                  <span className="xe:font-normal xe:text-muted-foreground" suppressHydrationWarning>{timeAgo(d.updatedAt)}</span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MediaPanel({ data, bySlug, count, bytes }: { data: DashboardData; bySlug: Map<string, ClientCollection>; count: number; bytes: number }) {
  const { basePath } = useAdmin();
  const first = [...bySlug.values()].find((c) => c.upload);
  const tiles = data.media.slice(0, 6);
  return (
    <Panel
      title="Media"
      meta={`${plural(count, "file")} · ${formatBytes(bytes)}`}
      action={first ? <Link href={adminRoutes.list(basePath, first.slug)} className="xe:shrink-0 xe:text-[13px] xe:font-medium xe:hover:underline xe:underline-offset-4">View all</Link> : null}
    >
      {tiles.length ? (
        <ul className="xe:grid xe:grid-cols-3 xe:gap-2 xe:px-5 xe:pb-5">
          {tiles.map((m) => (
            <li key={m.id}>
              <Link href={adminRoutes.edit(basePath, m.collection, m.id)} title={m.alt} className="xe:group xe:block xe:aspect-square xe:overflow-hidden xe:rounded-[4px] xe:bg-muted">
                {/* biome-ignore lint/performance/noImgElement: admin thumbnails come from the storage adapter */}
                <img src={m.url} alt={m.alt} loading="lazy" className="xe:size-full xe:object-cover xe:transition-opacity xe:group-hover:opacity-90" />
              </Link>
            </li>
          ))}
          {Array.from({ length: (3 - (tiles.length % 3)) % 3 }, (_, i) => (
            <li key={`pad-${i}`} aria-hidden className="xe:grid xe:aspect-square xe:place-items-center xe:rounded-[4px] xe:border xe:border-dashed xe:border-border">
              <RiImageLine className="xe:size-4 xe:text-muted-foreground/60" />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyRow>No images yet. Upload one to use it as a cover or inside an article.</EmptyRow>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ activity chart */

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Smallest "nice" number (1, 2, 5 × 10ⁿ) ≥ value, so gridlines land on round counts. */
function niceCeil(value: number): number {
  if (value <= 2) return 2;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * pow >= value) return step * pow;
  return 10 * pow;
}

/**
 * Documents per day, counted by their last edit (Xenon stores only the latest `updatedAt`, so a
 * document edited on several days counts once). Buckets use the viewer's local time, after mount.
 * Today's bar carries the hue; the rest are neutral.
 */
function Activity({ days, edited, created }: { days: number; edited: string[]; created: string[] }) {
  const [now, setNow] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  const series = useMemo(() => {
    if (now === null) return null;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: days }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (days - 1 - i));
      return { key: dayKey(date), date, edited: 0, created: 0 };
    });
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    for (const iso of edited) { const i = index.get(dayKey(new Date(iso))); if (i !== undefined) buckets[i]!.edited++; }
    for (const iso of created) { const i = index.get(dayKey(new Date(iso))); if (i !== undefined) buckets[i]!.created++; }
    return buckets;
  }, [now, days, edited, created]);

  const totalEdited = series?.reduce((n, b) => n + b.edited, 0) ?? 0;
  const totalCreated = series?.reduce((n, b) => n + b.created, 0) ?? 0;
  const max = niceCeil(Math.max(0, ...(series ?? []).map((b) => b.edited)));
  const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const shown = active !== null && series ? series[active]! : null;

  return (
    <Panel title="Activity" meta={`Last ${days} days`}>
      <div className="xe:flex xe:flex-1 xe:flex-col xe:px-5 xe:pb-4">
        <p className="xe:text-[13px] xe:text-muted-foreground" aria-live="polite">
          {shown ? (
            <><span className="xe:font-medium xe:text-foreground">{fmtDay(shown.date)}</span> · {shown.edited} edited · {shown.created} new</>
          ) : series ? (
            <><span className="xe:tabular-nums xe:text-foreground">{totalEdited}</span> edited · <span className="xe:tabular-nums xe:text-foreground">{totalCreated}</span> new, by day of last edit</>
          ) : " "}
        </p>
        <div className="xe:relative xe:mt-4 xe:min-h-36 xe:flex-1 xe:pl-6">
          {[1, 0.5, 0].map((f) => (
            <div key={f} aria-hidden className={cn("xe:absolute xe:right-0 xe:left-6 xe:border-t xe:border-border", f !== 0 && "xe:border-dashed xe:border-rule")} style={{ bottom: `${f * 100}%` }}>
              <span className="xe:absolute xe:-top-[7px] xe:-left-6 xe:w-4 xe:text-right xe:text-[11px] xe:leading-none xe:tabular-nums xe:text-muted-foreground">{Number.isInteger(max * f) ? max * f : ""}</span>
            </div>
          ))}
          <div className="xe:absolute xe:inset-y-0 xe:right-0 xe:left-6 xe:flex xe:items-end xe:gap-[2px]" onMouseLeave={() => setActive(null)}>
            {(series ?? Array.from({ length: days }, () => null)).map((b, i) => {
              const height = b ? (b.edited / max) * 100 : 0;
              const today = i === days - 1;
              return (
                <div
                  key={b?.key ?? i}
                  tabIndex={b ? 0 : -1}
                  aria-label={b ? `${fmtDay(b.date)}: ${plural(b.edited, "document")} edited, ${b.created} new` : undefined}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="xe:relative xe:flex xe:h-full xe:flex-1 xe:items-end xe:rounded-[2px] xe:outline-none xe:hover:bg-muted xe:focus-visible:bg-muted"
                >
                  <span
                    className={cn("xe:w-full xe:rounded-t-[2px]", today ? "xe:bg-brand" : active === i ? "xe:bg-foreground/70" : "xe:bg-foreground/25")}
                    style={{ height: `${height}%`, minHeight: b && b.edited > 0 ? 2 : 0 }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div aria-hidden className="xe:mt-2 xe:flex xe:justify-between xe:pl-6 xe:text-[11px] xe:text-muted-foreground" suppressHydrationWarning>
          <span>{series ? fmtDay(series[0]!.date) : " "}</span>
          <span>{series ? fmtDay(series[Math.floor(days / 2)]!.date) : ""}</span>
          <span>Today</span>
        </div>
        {series ? (
          <div className="xe:sr-only"><table>
            <caption>Documents edited and created per day, last {days} days</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">Edited</th><th scope="col">New</th></tr></thead>
            <tbody>{series.map((b) => <tr key={b.key}><th scope="row">{fmtDay(b.date)}</th><td className="xe:text-right xe:tabular-nums">{b.edited}</td><td className="xe:text-right xe:tabular-nums">{b.created}</td></tr>)}</tbody>
          </table></div>
        ) : null}
      </div>
    </Panel>
  );
}
