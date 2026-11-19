"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A choice remembered across tab groups and pages (the reader's package manager, "App Router" vs "Pages", …):
 * every group with the same key follows it. Falls back to the first item when storage is unavailable.
 */
const EVENT = "docs:choice";

function read(key: string) {
  try {
    return localStorage.getItem(`docs:${key}`);
  } catch {
    return null;
  }
}

export function useSyncedChoice(key: string, items: string[]) {
  const subscribe = useCallback((cb: () => void) => {
    const on = (e: Event) => {
      if (!(e instanceof CustomEvent) || e.detail === key) cb();
    };
    addEventListener(EVENT, on);
    addEventListener("storage", cb);
    return () => {
      removeEventListener(EVENT, on);
      removeEventListener("storage", cb);
    };
  }, [key]);
  const stored = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = stored && items.includes(stored) ? stored : items[0]!;
  const set = (v: string) => {
    try {
      localStorage.setItem(`docs:${key}`, v);
    } catch {
      /* private mode: this group still changes below */
    }
    dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  };
  return [value, set] as const;
}
