import { type ReactNode, Suspense } from "react";
import { cookies, headers as nextHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AdminRoot,
  AuthScreen,
  CollectionListView,
  DashboardView,
  DocumentEditor,
  SettingsView,
} from "xenon-cms/client";
import type { Where } from "../../adapters/types";
import type { XenonConfig } from "../../core/types";
import { toClientCollection } from "../../ui/shared/client-config";
import { type AccountSession, adminRoutes, type AdminUserInfo, type DocSummary, type SettingsTab } from "../../ui/shared/services";
import { getXenon } from "../xenon";
import { loadDashboard } from "./dashboard-data";
import { type AdminActionInput, type AdminActionResult, countUsers, loadAdminDoc, runAdminAction, toSummary } from "./action";

export type AdminTheme = "light" | "dark" | "system";

export interface AdminPageProps {
  config: XenonConfig;
  /** The user-land Server Action that calls `runAdminAction(config, input)`. */
  action: (input: AdminActionInput) => Promise<AdminActionResult>;
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_SIZE = 25;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

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
  const xenon = getXenon(config);
  await xenon.init();

  const base = config.admin.path;
  const theme = (cookieStore.get("xenon-theme")?.value as AdminTheme | undefined) ?? "system";
  const collections = config.collections.map(toClientCollection);
  const [section, slug, id, ...rest] = segments;
  const root = { theme, basePath: base, apiPath: config.api.path, action } as const;

  // `headers()` is the original request, but when this render follows a Server Action that rotated the
  // session (e.g. change password revokes sessions and issues a new cookie), only `cookies()` reflects
  // the new cookie. Reading the stale header would bounce the user through the login screen.
  const sessionHeaders = new Headers(headers);
  sessionHeaders.set("cookie", cookieStore.toString());
  const user = await xenon.getUser(sessionHeaders);

  // ------------------------------------------------------------------ auth screens
  if (!user || user.id.startsWith("apikey:")) {
    const needsSetup = (await countUsers(xenon)) === 0;
    if (needsSetup && section !== "setup") redirect(adminRoutes.setup(base));
    if (!needsSetup && section !== "login") redirect(adminRoutes.login(base));
    return (
      <AdminRoot {...root} collections={collections} user={null}>
        <AuthScreen mode={needsSetup ? "setup" : "login"} />
      </AdminRoot>
    );
  }
  if (section === "login" || section === "setup") redirect(adminRoutes.dashboard(base));

  const userInfo: AdminUserInfo = { id: user.id, email: user.email, name: user.name ?? null, role: user.role };
  const ctx = { user, overrideAccess: false } as const;
  const shell = (children: ReactNode) => (
    <AdminRoot {...root} collections={collections} user={userInfo}>
      {children}
    </AdminRoot>
  );

  // ------------------------------------------------------------------ dashboard
  if (!section) return shell(<DashboardView data={await loadDashboard(xenon, config, user)} />);

  // ------------------------------------------------------------------ collections
  if (section === "collections" && slug) {
    const collection = xenon.getCollection(slug);
    const client = collections.find((c) => c.slug === slug);
    if (!collection || !client || rest.length > 0) notFound();

    if (id === "new") return shell(<DocumentEditor key="new" collection={client} doc={null} />);
    if (id) {
      const doc = await loadAdminDoc(xenon, config, slug, id, user);
      if (!doc) notFound();
      return shell(<DocumentEditor key={doc.id} collection={client} doc={doc} />);
    }

    const q = first(query.q)?.trim() ?? "";
    const status = first(query.status);
    const page = Math.max(1, Number.parseInt(first(query.page) ?? "1", 10) || 1);
    const sort = first(query.sort) ?? "-updatedAt";
    const and: Where[] = [];
    if (status === "draft" || status === "published") and.push({ status: { equals: status } });
    if (q) {
      const titleKey = client.admin.useAsTitle;
      and.push({ or: [...(titleKey ? [{ [titleKey]: { contains: q } }] : []), { slug: { contains: q } }, ...(client.upload ? [{ filename: { contains: q } }] : [])] });
    }
    const res = await xenon.find({
      ...ctx,
      collection: slug,
      draft: true,
      where: and.length ? { and } : undefined,
      sort: /^-?[A-Za-z0-9_]+$/.test(sort) ? sort : "-updatedAt",
      limit: PAGE_SIZE,
      page,
    });
    return shell(
      <CollectionListView
        collection={client}
        rows={res.docs.map((d) => {
          const doc = d as Record<string, unknown>;
          return { ...toSummary(collection, doc), values: Object.fromEntries(client.fields.map((f) => [f.name, doc[f.name] ?? null])) };
        })}
        totalDocs={res.totalDocs}
        page={res.page}
        totalPages={res.totalPages}
        query={{ q, status: status ?? "all", sort }}
      />,
    );
  }

  // ------------------------------------------------------------------ settings
  // Old routes from before Settings existed.
  if (section === "account" && !slug) redirect(adminRoutes.settings(base));
  if (section === "users" && !slug) redirect(adminRoutes.settings(base, "team"));
  if (section === "settings" && !id) {
    const tab = (slug ?? "profile") as SettingsTab;
    if (!["profile", "appearance", "team"].includes(tab)) notFound();
    if (tab === "team" && user.role !== "admin") redirect(adminRoutes.settings(base));
    const [users, sessions] = await Promise.all([
      tab === "team" ? runAdminAction(config, { type: "users.list" }) : null,
      tab === "profile" ? runAdminAction(config, { type: "account.sessions" }) : null,
    ]);
    return shell(
      <SettingsView
        tab={tab}
        users={users?.ok ? (users.data as never) : []}
        sessions={sessions?.ok ? (sessions.data as AccountSession[]) : []}
      />,
    );
  }

  notFound();
}
