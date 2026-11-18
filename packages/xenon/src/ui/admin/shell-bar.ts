"use client";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

/**
 * The shell's 48px top bar lives in the frame, outside the page. A page fills it (breadcrumb, status,
 * actions) with `useShellBar`. Registration is an effect, so a route that Next keeps mounted but hidden
 * (cacheComponents) drops its bar when React disconnects its effects, and the visible route's bar wins.
 */
export interface Crumb {
  label: string;
  href?: string;
}
export interface ShellBarContent {
  crumbs?: Crumb[];
  /** Quiet status before the actions (a status pill, "Saved 2 minutes ago"). */
  status?: ReactNode;
  actions?: ReactNode;
}

type Entry = { id: number; content: ShellBarContent };
let entries: Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => entries;
const EMPTY: Entry[] = [];
const serverSnapshot = () => EMPTY;

export function useShellBarContent(): ShellBarContent | null {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return list.length ? list[list.length - 1]!.content : null;
}

export function useShellBar(content: ShellBarContent) {
  const id = useRef(0);
  if (!id.current) id.current = nextId++;
  // Mount/unmount (and hide/show under <Activity>): register and drop the entry.
  useEffect(() => {
    const own = id.current;
    return () => {
      entries = entries.filter((e) => e.id !== own);
      emit();
    };
  }, []);
  // Every render: publish the latest nodes (their handlers close over the page's current state).
  useLayoutEffect(() => {
    const own = id.current;
    const index = entries.findIndex((e) => e.id === own);
    const entry = { id: own, content };
    entries = index === -1 ? [...entries, entry] : entries.map((e, i) => (i === index ? entry : e));
    emit();
  });
}
