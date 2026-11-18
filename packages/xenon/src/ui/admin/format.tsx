"use client";
import { Badge } from "../components/badge";
import { cn } from "../lib/utils";

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 minutes ago", "yesterday", "just now". */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf?.format(Math.round(seconds / size), unit) ?? iso;
  }
  return "just now";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function StatusBadge({
  status,
  changed = false,
  className,
}: {
  status: "draft" | "published";
  changed?: boolean;
  className?: string;
}) {
  const label = status === "draft" ? "Draft" : changed ? "Unpublished changes" : "Published";
  const tone =
    status === "draft"
      ? "xe:bg-muted xe:text-muted-foreground"
      : changed
        ? "xe:bg-warning/15 xe:text-warning-foreground xe:dark:text-warning"
        : "xe:bg-success/12 xe:text-success";
  const dot = status === "draft" ? "xe:bg-muted-foreground/60" : changed ? "xe:bg-warning" : "xe:bg-success";
  return (
    <Badge variant="secondary" className={cn("xe:gap-1.5 xe:border-transparent xe:font-medium", tone, className)}>
      <span className={cn("xe:size-1.5 xe:rounded-full", dot)} aria-hidden />
      {label}
    </Badge>
  );
}

export function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
