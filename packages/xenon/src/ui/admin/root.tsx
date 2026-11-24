"use client";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "../components/sonner";
import { TooltipProvider } from "../components/tooltip";
import { PortalContainerProvider } from "../lib/portal-container";
import { AdminProvider } from "../shared/admin-context";
import type { ClientCollection } from "../shared/client-config";
import type { AdminUserInfo } from "../shared/services";
import { type AdminAction, AdminRuntimeProvider, useServices } from "./runtime";
import { acquireColorScheme, type AdminTheme, applyColorScheme, useAdminTheme, useSystemDark } from "./theme-store";
import { PresenceHeartbeat } from "./presence";
import { AdminShell } from "./shell";

export interface AdminRootProps {
  theme: AdminTheme;
  basePath: string;
  apiPath: string;
  action: AdminAction;
  collections: ClientCollection[];
  user: AdminUserInfo | null;
  /** Signed presence token (null when presence is off). */
  presenceToken?: string | null;
  children: ReactNode;
}

function SignedIn({ basePath, apiPath, collections, user, presenceToken, children }: Omit<AdminRootProps, "theme" | "action" | "user"> & { user: AdminUserInfo }) {
  const services = useServices();
  const value = useMemo(() => ({ basePath, apiPath, collections, user, services }), [basePath, apiPath, collections, user, services]);
  return (
    <AdminProvider value={value}>
      <PresenceHeartbeat token={presenceToken ?? null} />
      <AdminShell>{children}</AdminShell>
    </AdminProvider>
  );
}

/** Root of the admin: scoped `.xenon-admin` element, theme, portals, toasts and runtime services. */
export function AdminRoot({ theme, basePath, apiPath, action, collections, user, presenceToken, children }: AdminRootProps) {
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

  return (
    <div
      ref={rootRef}
      data-theme={current}
      className={`xenon-admin${current === "dark" ? " dark" : ""} xe:min-h-dvh xe:bg-frame xe:text-foreground`}
    >
      <PortalContainerProvider value={portal}>
        <TooltipProvider delay={400}>
          <AdminRuntimeProvider basePath={basePath} apiPath={apiPath} action={action} theme={theme}>
            {user ? (
              <SignedIn basePath={basePath} apiPath={apiPath} collections={collections} user={user} presenceToken={presenceToken}>
                {children}
              </SignedIn>
            ) : (
              children
            )}
          </AdminRuntimeProvider>
        </TooltipProvider>
        <Toaster theme={dark ? "dark" : "light"} position="bottom-right" />
      </PortalContainerProvider>
    </div>
  );
}
