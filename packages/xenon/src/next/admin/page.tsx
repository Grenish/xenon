import { type ReactNode, Suspense } from "react";
import Link from "next/link";
import { cookies, headers as nextHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AdminRoot,
  AuthScreen,
  CollectionListView,
  DashboardView,
  DocumentEditor,
  GlobalEditor,
  SettingsView,
} from "xenon-cms/client";
import { NextAdminRouter } from "xenon-cms/next-client";
import type { XenonConfig } from "../../core/types";
import {
  canReadCollection,
  canReadGlobal,
  filterReadableCollections,
  filterReadableGlobals,
  loadAdminData,
  resolveAdminSort,
  unpublishedChangesOnPage,
} from "../../http/admin-loader";
import { adminRoutes, type AdminTheme } from "../../ui/shared/services";
import { getXenon } from "../xenon";
import { type AdminActionInput, type AdminActionResult, mergeSessionHeaders } from "./action";

export { canReadCollection, canReadGlobal, filterReadableCollections, filterReadableGlobals, resolveAdminSort, unpublishedChangesOnPage };
export type { AdminTheme };

export interface AdminPageProps {
  config: XenonConfig;
  /** Optional user-land Server Action that calls `runAdminAction(config, input)`. Omit to use HTTP `/_admin/action`. */
  action?: (input: AdminActionInput) => Promise<AdminActionResult>;
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function AccessDenied({ base, label }: { base: string; label: string }) {
  return (
    <section className="xe:flex xe:flex-col xe:items-start xe:gap-2 xe:rounded-lg xe:border xe:border-border xe:bg-card xe:p-6">
      <h1 className="xe:text-[15px] xe:font-semibold">You don’t have access to {label}</h1>
      <p className="xe:text-sm xe:text-muted-foreground">Ask an admin if you need permission to view this collection.</p>
      <Link href={adminRoutes.dashboard(base)} className="xe:mt-2 xe:text-sm xe:font-medium xe:underline xe:underline-offset-4">
        Back to overview
      </Link>
    </section>
  );
}

/**
 * The XenonCMS admin (Server Component). Mount at `app/admin/[[...segments]]/page.tsx`.
 * Wrapped in Suspense so it works with or without `cacheComponents` (it reads cookies/headers).
 */
export function AdminPage(props: AdminPageProps) {
  return (
    <Suspense fallback={null}>
      <AdminPageContent {...props} />
    </Suspense>
  );
}

async function AdminPageContent({ config, action, params, searchParams }: AdminPageProps) {
  const [{ segments = [] }, query, headers, cookieStore] = await Promise.all([params, searchParams, nextHeaders(), cookies()]);
  const theme = (cookieStore.get("xenon-theme")?.value as AdminTheme | undefined) ?? "system";

  // `headers()` is the original request, but when this render follows a Server Action that rotated the
  // session (e.g. change password revokes sessions and issues a new cookie), only `cookies()` reflects
  // the new cookie. Reading the stale header would bounce the user through the login screen.
  const sessionHeaders = mergeSessionHeaders(headers, cookieStore.toString());
  const payload = await loadAdminData({
    config,
    xenon: getXenon(config),
    segments,
    query,
    headers: sessionHeaders,
    theme,
  });

  if (payload.kind === "redirect") redirect(payload.to);
  if (payload.kind === "not-found") notFound();

  const renderShell = (children: ReactNode) => (
    <NextAdminRouter>
      <AdminRoot
        theme={payload.shell.theme}
        basePath={payload.shell.basePath}
        apiPath={payload.shell.apiPath}
        action={action}
        collections={payload.shell.collections}
        globals={payload.shell.globals}
        user={payload.shell.user}
        presenceToken={payload.shell.presenceToken}
        presignedUploads={payload.shell.presignedUploads}
      >
        {children}
      </AdminRoot>
    </NextAdminRouter>
  );

  switch (payload.kind) {
    case "auth":
      return renderShell(<AuthScreen mode={payload.mode} />);
    case "access-denied":
      return renderShell(<AccessDenied base={payload.shell.basePath} label={payload.label} />);
    case "dashboard":
      return renderShell(<DashboardView data={payload.data} />);
    case "collection-list":
      return renderShell(
        <CollectionListView
          key={payload.collection.slug}
          collection={payload.collection}
          rows={payload.rows}
          totalDocs={payload.totalDocs}
          page={payload.page}
          totalPages={payload.totalPages}
          query={payload.query}
        />,
      );
    case "document-new":
      return renderShell(<DocumentEditor key="new" collection={payload.collection} doc={null} />);
    case "document-edit":
      return renderShell(<DocumentEditor key={payload.doc.id} collection={payload.collection} doc={payload.doc} />);
    case "global-edit":
      return renderShell(<GlobalEditor key={payload.global.slug} global={payload.global} doc={payload.doc} />);
    case "settings":
      return renderShell(<SettingsView tab={payload.tab} users={payload.users} sessions={payload.sessions} />);
  }
}
