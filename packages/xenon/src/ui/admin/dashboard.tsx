"use client";
import { RiAddLine, RiArrowDownSLine, RiArrowRightSLine, RiCheckboxCircleLine } from "@remixicon/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "../components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "../components/dropdown-menu";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import type { ClientCollection } from "../shared/client-config";
import { adminRoutes, type DashboardData, type DashboardDoc } from "../shared/services";
import { StatusBadge, formatDate, greeting, timeAgo } from "./format";
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

export function DashboardView({ data }: { data: DashboardData }) {
  const { user, collections } = useAdmin();
  const [hello, setHello] = useState("Welcome back");
  useEffect(() => setHello(greeting()), []); // local time only on the client

  const bySlug = useMemo(() => new Map(collections.map((c) => [c.slug, c])), [collections]);
  const content = data.collections.filter((s) => !bySlug.get(s.slug)?.upload);
  const uploads = data.collections.filter((s) => bySlug.get(s.slug)?.upload);
  const sum = (key: "published" | "drafts" | "changed" | "total") => content.reduce((n, s) => n + s[key], 0);
  const media = uploads.reduce((acc, s) => ({ count: acc.count + s.total, bytes: acc.bytes + (s.bytes ?? 0) }), { count: 0, bytes: 0 });
  const hasDrafts = content.some((s) => bySlug.get(s.slug)?.drafts);

  return (
    <div className="xe:flex xe:flex-col xe:gap-8">
      <header className="xe:flex xe:flex-wrap xe:items-end xe:justify-between xe:gap-4">
        <div className="xe:flex xe:flex-col xe:gap-1">
          <h1 className="xe:text-2xl xe:font-semibold xe:tracking-tight">
            {hello}
            {user.name ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="xe:text-muted-foreground">
            {data.attentionTotal > 0 ? `${plural(data.attentionTotal, "item")} ${data.attentionTotal === 1 ? "needs" : "need"} your attention.` : "Everything is published and up to date."}
          </p>
        </div>
        <NewMenu collections={collections} />
      </header>

      <section aria-label="Overview" className="xe:grid xe:gap-4 xe:sm:grid-cols-2 xe:xl:grid-cols-4">
        <Stat label="Published" value={sum("published")} hint={`of ${plural(sum("total"), "document")}`} />
        {hasDrafts ? <Stat label="Drafts" value={sum("drafts")} hint="not yet published" /> : <Stat label="Documents" value={sum("total")} hint={`across ${plural(content.length, "collection")}`} />}
        {hasDrafts ? <Stat label="Unpublished changes" value={sum("changed")} hint="live, with edits pending" /> : null}
        {uploads.length ? <Stat label="Media" value={media.count} hint={`${formatBytes(media.bytes)} stored`} /> : null}
      </section>

      <Activity days={data.activity.days} edited={data.activity.edited} created={data.activity.created} />

      <div className="xe:grid xe:items-start xe:gap-6 xe:lg:grid-cols-2">
        <Panel
          title="Needs attention"
          description={hasDrafts ? "Drafts and published items with pending edits, oldest first." : "Nothing in these collections uses drafts."}
          count={data.attentionTotal}
        >
          {data.attention.length ? <DocList docs={data.attention} bySlug={bySlug} /> : (
            <div className="xe:flex xe:flex-col xe:items-center xe:gap-2 xe:px-6 xe:py-10 xe:text-center">
              <RiCheckboxCircleLine className="xe:size-6 xe:text-muted-foreground" aria-hidden />
              <p className="xe:text-sm xe:font-medium">You're all caught up</p>
              <p className="xe:text-sm xe:text-muted-foreground">No drafts or unpublished changes.</p>
            </div>
          )}
        </Panel>
        <Panel title="Recently edited" description="The latest changes across every collection.">
          {data.recent.length ? <DocList docs={data.recent} bySlug={bySlug} /> : (
            <p className="xe:px-6 xe:py-10 xe:text-center xe:text-sm xe:text-muted-foreground">Nothing here yet. Create your first item to get started.</p>
          )}
        </Panel>
      </div>

      <CollectionsPanel stats={data.collections} bySlug={bySlug} />
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
            return <DropdownMenuItem key={c.slug} onClick={() => router.push(adminRoutes.create(basePath, c.slug))}><Icon />{c.labels.singular}</DropdownMenuItem>;
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="xe:flex xe:flex-col xe:gap-1 xe:rounded-lg xe:border xe:border-border xe:bg-card xe:px-5 xe:py-4 xe:shadow-xs">
      <p className="xe:text-sm xe:text-muted-foreground">{label}</p>
      <p className="xe:text-[1.75rem] xe:font-semibold xe:leading-tight xe:tracking-tight xe:tabular-nums">{value.toLocaleString()}</p>
      <p className="xe:text-xs xe:text-muted-foreground">{hint}</p>
    </div>
  );
}

function Panel({ title, description, count, children, action }: { title: string; description?: string; count?: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="xe:flex xe:min-w-0 xe:flex-col xe:rounded-lg xe:border xe:border-border xe:bg-card xe:shadow-xs">
      <header className="xe:flex xe:items-start xe:justify-between xe:gap-4 xe:border-b xe:border-border xe:px-5 xe:py-4">
        <div className="xe:flex xe:min-w-0 xe:flex-col xe:gap-0.5">
          <h2 className="xe:flex xe:items-center xe:gap-2 xe:text-[15px] xe:font-semibold">
            {title}
            {count ? <span className="xe:rounded-full xe:bg-muted xe:px-2 xe:py-0.5 xe:text-xs xe:font-medium xe:tabular-nums xe:text-muted-foreground">{count}</span> : null}
          </h2>
          {description ? <p className="xe:text-sm xe:text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function DocList({ docs, bySlug }: { docs: DashboardDoc[]; bySlug: Map<string, ClientCollection> }) {
  const { basePath } = useAdmin();
  return (
    <ul className="xe:divide-y xe:divide-border">
      {docs.map((d) => {
        const c = bySlug.get(d.collection);
        const Icon = c ? collectionIcon(c) : null;
        const showStatus = c?.drafts && !c.upload;
        return (
          <li key={`${d.collection}:${d.id}`}>
            <Link href={adminRoutes.edit(basePath, d.collection, d.id)} className="xe:group xe:flex xe:items-center xe:gap-3 xe:px-5 xe:py-3 xe:transition-colors xe:hover:bg-muted/50 xe:focus-visible:bg-muted/50">
              {Icon ? <span className="xe:grid xe:size-8 xe:shrink-0 xe:place-items-center xe:rounded-md xe:border xe:border-border xe:bg-background"><Icon className="xe:size-4 xe:text-muted-foreground" /></span> : null}
              <span className="xe:min-w-0 xe:flex-1">
                <span className="xe:block xe:truncate xe:text-sm xe:font-medium">{d.title}</span>
                <span className="xe:block xe:truncate xe:text-xs xe:text-muted-foreground">
                  {c?.labels.singular ?? d.collection} · <time dateTime={d.updatedAt} title={formatDate(d.updatedAt)} suppressHydrationWarning>edited {timeAgo(d.updatedAt)}</time>
                </span>
              </span>
              {showStatus ? <StatusBadge status={d.status} changed={d.changed} className="xe:shrink-0" /> : null}
              <RiArrowRightSLine className="xe:size-4 xe:shrink-0 xe:text-muted-foreground xe:opacity-0 xe:transition-opacity xe:group-hover:opacity-100" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function CollectionsPanel({ stats, bySlug }: { stats: DashboardData["collections"]; bySlug: Map<string, ClientCollection> }) {
  const { basePath } = useAdmin();
  return (
    <Panel title="Collections" description="What's in each collection.">
      <ul className="xe:divide-y xe:divide-border">
        {stats.map((s) => {
          const c = bySlug.get(s.slug);
          if (!c) return null;
          const Icon = collectionIcon(c);
          const showStatus = c.drafts && !c.upload;
          const pct = s.total ? (s.published / s.total) * 100 : 0;
          return (
            <li key={s.slug} className="xe:flex xe:flex-wrap xe:items-center xe:gap-x-5 xe:gap-y-2 xe:px-5 xe:py-3.5">
              <Link href={adminRoutes.list(basePath, s.slug)} className="xe:flex xe:min-w-40 xe:items-center xe:gap-3 xe:text-sm xe:font-medium xe:hover:underline xe:underline-offset-4">
                <span className="xe:grid xe:size-8 xe:shrink-0 xe:place-items-center xe:rounded-md xe:border xe:border-border xe:bg-background"><Icon className="xe:size-4 xe:text-muted-foreground" /></span>
                {c.labels.plural}
              </Link>
              <div className="xe:flex xe:min-w-0 xe:flex-1 xe:items-center xe:gap-4">
                {showStatus ? (
                  // Published vs draft share; identity is also spelled out in the text beside it.
                  <div className="xe:flex xe:h-1.5 xe:w-full xe:max-w-56 xe:gap-[2px] xe:overflow-hidden xe:rounded-full" role="img" aria-label={`${s.published} published, ${s.drafts} drafts`}>
                    {s.published ? <span className="xe:h-full xe:rounded-full xe:bg-foreground" style={{ width: `${pct}%` }} /> : null}
                    {s.drafts ? <span className="xe:h-full xe:flex-1 xe:rounded-full xe:bg-muted-foreground/30" /> : null}
                    {!s.total ? <span className="xe:h-full xe:flex-1 xe:rounded-full xe:bg-muted" /> : null}
                  </div>
                ) : null}
                <p className="xe:text-sm xe:tabular-nums xe:text-muted-foreground">
                  {c.upload
                    ? `${plural(s.total, "file")} · ${formatBytes(s.bytes ?? 0)}`
                    : showStatus
                      ? [`${s.published.toLocaleString()} published`, `${plural(s.drafts, "draft")}`, s.changed ? `${s.changed.toLocaleString()} with changes` : ""].filter(Boolean).join(" · ")
                      : plural(s.total, "item")}
                </p>
              </div>
              <Link href={adminRoutes.create(basePath, s.slug)} className="xe:inline-flex xe:h-8 xe:items-center xe:gap-1 xe:rounded-md xe:px-2.5 xe:text-sm xe:text-muted-foreground xe:transition-colors xe:hover:bg-muted xe:hover:text-foreground">
                <RiAddLine className="xe:size-4" />New
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------ activity chart */

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Smallest "nice" number (1, 2, 5 × 10ⁿ) ≥ value, so gridlines land on round counts. */
function niceCeil(value: number): number {
  if (value <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * pow >= value) return step * pow;
  return 10 * pow;
}

/**
 * Single-series bar chart: documents per day, counted by their last edit. Xenon stores only the
 * latest `updatedAt`, so a document edited on several days counts once, on its most recent day.
 * Buckets use the viewer's local time, so they're computed after mount.
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

  return (
    <Panel
      title="Activity"
      description={`Documents by day of last edit · last ${days} days`}
      action={
        <dl className="xe:flex xe:shrink-0 xe:gap-6 xe:text-right">
          <div><dt className="xe:text-xs xe:text-muted-foreground">Edited</dt><dd className="xe:text-lg xe:font-semibold xe:tabular-nums">{series ? totalEdited : "–"}</dd></div>
          <div><dt className="xe:text-xs xe:text-muted-foreground">New</dt><dd className="xe:text-lg xe:font-semibold xe:tabular-nums">{series ? totalCreated : "–"}</dd></div>
        </dl>
      }
    >
      <div className="xe:px-5 xe:pt-5 xe:pb-4">
        <div className="xe:relative xe:h-40 xe:pl-7">
          {/* Recessive grid: baseline, half and top, labelled on the left. */}
          {[1, 0.5, 0].map((f) => (
            <div key={f} aria-hidden className="xe:absolute xe:right-0 xe:left-7 xe:border-t xe:border-dashed xe:border-border" style={{ bottom: `${f * 100}%`, borderStyle: f === 0 ? "solid" : undefined }}>
              <span className="xe:absolute xe:-top-2 xe:-left-7 xe:w-5 xe:text-right xe:text-[11px] xe:leading-none xe:tabular-nums xe:text-muted-foreground">{Number.isInteger(max * f) ? max * f : ""}</span>
            </div>
          ))}
          <div className="xe:absolute xe:inset-y-0 xe:right-0 xe:left-7 xe:flex xe:items-end xe:gap-[2px]" onMouseLeave={() => setActive(null)}>
            {(series ?? Array.from({ length: days }, () => null)).map((b, i) => {
              const height = b ? (b.edited / max) * 100 : 0;
              const label = b ? `${fmtDay(b.date)}: ${plural(b.edited, "document")} edited, ${b.created} new` : "";
              return (
                <div
                  key={b?.key ?? i}
                  tabIndex={b ? 0 : -1}
                  aria-label={label || undefined}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="xe:relative xe:flex xe:h-full xe:flex-1 xe:items-end xe:outline-none xe:focus-visible:bg-muted/60"
                >
                  {active === i ? <span aria-hidden className="xe:absolute xe:inset-0 xe:rounded-sm xe:bg-muted/60" /> : null}
                  <span
                    className={cn("xe:relative xe:w-full xe:rounded-t-[4px] xe:transition-[height,background-color]", active === null || active === i ? "xe:bg-foreground/85" : "xe:bg-foreground/35", !b && "xe:bg-muted")}
                    style={{ height: b ? `${height}%` : "4%", minHeight: b && b.edited > 0 ? 2 : 0 }}
                  />
                  {b && active === i ? (
                    <div role="tooltip" style={{ bottom: `calc(${Math.min(height, 62)}% + 8px)` }} className={cn("xe:pointer-events-none xe:absolute xe:z-10 xe:w-max xe:rounded-md xe:border xe:border-border xe:bg-popover xe:px-2.5 xe:py-1.5 xe:text-xs xe:text-popover-foreground xe:shadow-md",
                      i < 4 ? "xe:left-0" : i > days - 5 ? "xe:right-0" : "xe:left-1/2 xe:-translate-x-1/2")}>
                      <p className="xe:font-medium">{fmtDay(b.date)}</p>
                      <p className="xe:text-muted-foreground"><span className="xe:font-medium xe:text-foreground xe:tabular-nums">{b.edited}</span> edited · <span className="xe:font-medium xe:text-foreground xe:tabular-nums">{b.created}</span> new</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <div aria-hidden className="xe:mt-2 xe:flex xe:justify-between xe:pl-7 xe:text-[11px] xe:text-muted-foreground">
          <span>{series ? fmtDay(series[0]!.date) : " "}</span>
          <span>{series ? fmtDay(series[Math.floor(days / 2)]!.date) : ""}</span>
          <span>Today</span>
        </div>
        {/* Table view for screen readers. */}
        {series ? (
          // sr-only on a wrapper: a table can't shrink below its content, so on the table itself it adds page height.
          <div className="xe:sr-only"><table>
            <caption>Documents edited and created per day, last {days} days</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">Edited</th><th scope="col">New</th></tr></thead>
            <tbody>{series.map((b) => <tr key={b.key}><th scope="row">{fmtDay(b.date)}</th><td>{b.edited}</td><td>{b.created}</td></tr>)}</tbody>
          </table></div>
        ) : null}
      </div>
    </Panel>
  );
}
