"use client";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "../components/sonner";
import { TooltipProvider } from "../components/tooltip";
import { PortalContainerProvider } from "../lib/portal-container";
import { AdminProvider } from "../shared/admin-context";
import type { ClientCollection, ClientGlobal } from "../shared/client-config";
import { type AdminRouter, AdminRouterProvider } from "../shared/router";
import type { AdminUserInfo } from "../shared/services";
import { type AdminAction, AdminRuntimeProvider, useServices } from "./runtime";
import { acquireColorScheme, type AdminTheme, applyColorScheme, useAdminTheme, useSystemDark } from "./theme-store";
import { PresenceHeartbeat } from "./presence";
import { AdminShell } from "./shell";

export interface AdminRootProps {
  theme: AdminTheme;
  basePath: string;
  apiPath: string;
  /** Optional host action transport (e.g. Next.js Server Action). Defaults to HTTP `POST {apiPath}/_admin/action`. */
  action?: AdminAction;
  /** Optional host router adapter (defaults to an outer `<AdminRouterProvider>` or the built-in History API router). */
  router?: AdminRouter;
  collections: ClientCollection[];
  globals?: ClientGlobal[];
  user: AdminUserInfo | null;
  /** Signed presence token (null when presence is off). */
  presenceToken?: string | null;
  /** `true` when the configured storage adapter supports direct presigned uploads (`_presign` → PUT → `_complete`). */
  presignedUploads?: boolean;
  children: ReactNode;
}

const EMPTY_GLOBALS: ClientGlobal[] = [];

function SignedIn({ basePath, apiPath, collections, globals, user, presenceToken, children }: Omit<AdminRootProps, "theme" | "action" | "router" | "user" | "presignedUploads"> & { user: AdminUserInfo }) {
  const services = useServices();
  const safeGlobals = globals ?? EMPTY_GLOBALS;
  const value = useMemo(
    () => ({ basePath, apiPath, collections, globals: safeGlobals, user, services }),
    [basePath, apiPath, collections, safeGlobals, user, services],
  );
  return (
    <AdminProvider value={value}>
      <PresenceHeartbeat token={presenceToken ?? null} />
      <AdminShell>{children}</AdminShell>
    </AdminProvider>
  );
}

/** Root of the admin: scoped `.xenon-admin` element, theme, portals, toasts and runtime services. */
export function AdminRoot({ theme, basePath, apiPath, action, router, collections, globals, user, presenceToken, presignedUploads, children }: AdminRootProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const current = useAdminTheme(theme);
  const systemDark = useSystemDark();

  useEffect(() => setPortal(rootRef.current), []);

  // "system" is handled in CSS (prefers-color-scheme on [data-theme="system"]); this feeds the Toaster
  // and the page's color-scheme (scrollbars, form controls, overscroll area).
  const dark = current === "dark" || (current === "system" && systemDark);
  useEffect(() => acquireColorScheme(document.documentElement), []);
  useEffect(() => {
    applyColorScheme(document.documentElement, dark);
  }, [dark]);

  const runtime = (
    <AdminRuntimeProvider basePath={basePath} apiPath={apiPath} action={action} theme={theme} presignedUploads={presignedUploads}>
      {user ? (
        <SignedIn basePath={basePath} apiPath={apiPath} collections={collections} globals={globals} user={user} presenceToken={presenceToken}>
          {children}
        </SignedIn>
      ) : (
        children
      )}
    </AdminRuntimeProvider>
  );

  return (
    <div
      ref={rootRef}
      data-theme={current}
      className={`xenon-admin${current === "dark" ? " dark" : ""} xe:min-h-dvh xe:bg-frame xe:text-foreground`}
    >
      <PortalContainerProvider value={portal}>
        <TooltipProvider delay={400}>
          {router ? <AdminRouterProvider router={router}>{runtime}</AdminRouterProvider> : runtime}
        </TooltipProvider>
        <Toaster theme={dark ? "dark" : "light"} position="bottom-right" />
      </PortalContainerProvider>
    </div>
  );
}
