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

/** One status mark per document: a pale pill with an ink of the same hue. */
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
  const tone = status === "draft" ? "xe:bg-pill-draft xe:text-pill-draft-ink" : changed ? "xe:bg-pill-changed xe:text-pill-changed-ink" : "xe:bg-pill-live xe:text-pill-live-ink";
  const dot = status === "draft" ? "xe:bg-pill-draft-ink/45" : changed ? "xe:bg-warning" : "xe:bg-success";
  return (
    <Badge variant="secondary" className={cn("xe:h-5 xe:flex-none xe:gap-1.5 xe:rounded-full xe:border-transparent xe:px-2 xe:text-xs xe:font-medium xe:whitespace-nowrap", tone, className)}>
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
