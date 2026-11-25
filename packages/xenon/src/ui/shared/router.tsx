"use client";
import {
  type ComponentPropsWithoutRef,
  type ComponentType,
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";

export interface AdminLinkProps extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
  href: string;
}

export interface AdminNavigateOptions {
  scroll?: boolean;
}

/**
 * Framework-agnostic router contract for the Xenon Admin UI.
 * Hosts (Next.js, Astro, TanStack Start, SPA) can supply an adapter via `<AdminRouterProvider>`;
 * when omitted, Xenon uses the built-in History API default router.
 */
export interface AdminRouter {
  Link: ComponentType<AdminLinkProps>;
  usePathname: () => string;
  push: (href: string, options?: AdminNavigateOptions) => void;
  replace: (href: string, options?: AdminNavigateOptions) => void;
  refresh: () => void;
}

export interface HistoryRouterOptions {
  /** Pathname used during SSR (or when `window` is unavailable). Defaults to `"/"`. */
  initialPathname?: string;
  /** Invoked on `router.refresh()` so HTTP/SPA hosts can re-fetch `/_admin/data`. */
  onRefresh?: () => void;
}

/* ------------------------------------------------------------------ built-in History API router */

const listeners = new Set<() => void>();
let popstateBound = false;

function notifyHistoryListeners() {
  for (const listener of listeners) listener();
}

function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined" && !popstateBound) {
    window.addEventListener("popstate", notifyHistoryListeners);
    popstateBound = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined" && popstateBound) {
      window.removeEventListener("popstate", notifyHistoryListeners);
      popstateBound = false;
    }
  };
}

function currentPathname(fallback: string): string {
  return typeof window !== "undefined" ? window.location.pathname : fallback;
}

function isSameOriginUrl(href: string): boolean {
  if (typeof window === "undefined") return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//");
  try {
    return new URL(href, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Creates a framework-agnostic `AdminRouter` backed by the browser History API. */
export function createHistoryRouter(options: HistoryRouterOptions = {}): AdminRouter {
  const fallback = options.initialPathname ?? "/";

  function push(href: string, nav?: AdminNavigateOptions) {
    if (typeof window === "undefined") return;
    window.history.pushState(null, "", href);
    notifyHistoryListeners();
    if (nav?.scroll !== false) window.scrollTo?.(0, 0);
  }

  function replace(href: string, nav?: AdminNavigateOptions) {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", href);
    notifyHistoryListeners();
    if (nav?.scroll !== false) window.scrollTo?.(0, 0);
  }

  function refresh() {
    options.onRefresh?.();
    notifyHistoryListeners();
  }

  function usePathname(): string {
    return useSyncExternalStore(
      subscribeHistory,
      () => currentPathname(fallback),
      () => fallback,
    );
  }

  function HistoryLink({ href, onClick, target, download, ...rest }: AdminLinkProps) {
    function handleClick(event: MouseEvent<HTMLAnchorElement>) {
      onClick?.(event);
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        target === "_blank" ||
        download !== undefined ||
        !isSameOriginUrl(href)
      ) {
        return;
      }
      event.preventDefault();
      push(href);
    }
    return <a href={href} target={target} download={download} onClick={handleClick} {...rest} />;
  }

  return { Link: HistoryLink, usePathname, push, replace, refresh };
}

/** Default built-in History API router used when no host `<AdminRouterProvider>` is mounted. */
export const defaultHistoryRouter: AdminRouter = createHistoryRouter();

export const AdminRouterContext = createContext<AdminRouter>(defaultHistoryRouter);

export function AdminRouterProvider({ router, children }: { router: AdminRouter; children: ReactNode }) {
  return <AdminRouterContext.Provider value={router}>{children}</AdminRouterContext.Provider>;
}

/** Returns the active `AdminRouter` (host-provided or the built-in History API default). */
export function useAdminRouter(): AdminRouter {
  return useContext(AdminRouterContext);
}

/** Returns the active pathname from the current `AdminRouter`. */
export function useAdminPathname(): string {
  return useAdminRouter().usePathname();
}

/** Renders a link using the active `AdminRouter`'s `Link` component. */
export function AdminLink(props: AdminLinkProps) {
  const { Link } = useAdminRouter();
  return <Link {...props} />;
}
