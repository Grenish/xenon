import { useSyncExternalStore } from "react";

export type AdminTheme = "light" | "dark" | "system";

/*
 * One theme for the whole admin, shared by every mounted route.
 *
 * With `cacheComponents`, Next.js keeps previously visited routes mounted (hidden) and shows them
 * again on back/forward. Each route renders its own <AdminRoot>, so theme kept in React state
 * diverged per route: switch the theme on one page, go back, and the old page still had the old
 * theme. A module-level store fixes that; the cookie only seeds the first render on the server.
 */
let current: AdminTheme | null = null;
const listeners = new Set<() => void>();

function readCookie(): AdminTheme | null {
  if (typeof document === "undefined") return null;
  const value = /(?:^|;\s*)xenon-theme=(light|dark|system)/.exec(document.cookie)?.[1];
  return (value as AdminTheme | undefined) ?? null;
}

export const themeStore = {
  get(fallback: AdminTheme): AdminTheme {
    current ??= readCookie() ?? fallback;
    return current;
  },
  set(next: AdminTheme) {
    current = next;
    document.cookie = `xenon-theme=${next}; path=/; max-age=31536000; samesite=lax`;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The admin theme; `initial` is the server-rendered value (from the cookie). */
export function useAdminTheme(initial: AdminTheme): AdminTheme {
  return useSyncExternalStore(themeStore.subscribe, () => themeStore.get(initial), () => initial);
}

const darkQuery = "(prefers-color-scheme: dark)";

/** Whether the OS prefers dark mode (false on the server). */
export function useSystemDark(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const mq = window.matchMedia(darkQuery);
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    },
    () => window.matchMedia(darkQuery).matches,
    () => false,
  );
}
