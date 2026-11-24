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
  SettingsView,
} from "xenon-cms/client";
import type { Where } from "../../adapters/types";
import { isXenonError } from "../../core/errors";
import { type AnyCollection, SYSTEM_KEYS, type SystemFields, UPLOAD_KEYS, type XenonConfig, type XenonUser } from "../../core/types";
import { toClientCollection } from "../../ui/shared/client-config";
import { type AccountSession, adminRoutes, type AdminUserInfo, type SettingsTab } from "../../ui/shared/services";
import { resolveSecret } from "../../auth";
import { signPresenceToken } from "../../server/presence";
import { getXenon } from "../xenon";
import { loadDashboard } from "./dashboard-data";
import {
  type AdminActionInput,
  type AdminActionResult,
  countUsers,
  dispatchAdminAction,
  loadAdminDoc,
  mergeSessionHeaders,
  toSummary,
} from "./action";

export type AdminTheme = "light" | "dark" | "system";

export interface AdminPageProps {
  config: XenonConfig;
  /** The user-land Server Action that calls `runAdminAction(config, input)`. */
  action: (input: AdminActionInput) => Promise<AdminActionResult>;
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_SIZE = 25;
const SYSTEM_SORT_KEYS = new Set<string>(SYSTEM_KEYS);
const UPLOAD_SORT_KEYS = new Set<string>(UPLOAD_KEYS);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Validate a collection list sort parameter against declared fields (including hyphenated names) and system/upload keys. */
export function resolveAdminSort(collection: AnyCollection, sort: string | undefined): string {
  const raw = sort?.trim();
  if (!raw) return "-updatedAt";
  const key = raw.startsWith("-") ? raw.slice(1) : raw;
  if (!key) return "-updatedAt";
  if (SYSTEM_SORT_KEYS.has(key) || (collection.upload && UPLOAD_SORT_KEYS.has(key)) || Object.hasOwn(collection.fields, key)) {
    return raw;
  }
  return "-updatedAt";
}

export async function canReadCollection(collection: AnyCollection, user: XenonUser): Promise<boolean> {
  const fn = collection.access?.read;
  if (!fn) return true;
  return Boolean(await fn({ user }));
}

export async function filterReadableCollections(config: XenonConfig, user: XenonUser): Promise<AnyCollection[]> {
  const checked = await Promise.all(config.collections.map(async (c) => ((await canReadCollection(c, user)) ? c : null)));
  return checked.filter((c): c is AnyCollection => c !== null);
}

/** Look up working copies only for published documents on this access-checked page. */
export async function unpublishedChangesOnPage(db: XenonConfig["db"], collection: string, docs: readonly Pick<SystemFields, "id" | "status">[]) {
  const ids = docs.filter(doc => doc.status === "published").map(doc => doc.id);
  if (!db || !ids.length) return new Set<string>();
  const records = await db.find({ collection, source: "draft", where: { id: { in: ids } }, limit: ids.length });
  return new Set(records.docs.filter(doc => doc.status === "published" && doc.draftData !== null).map(doc => doc.id));
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
  const sessionHeaders = mergeSessionHeaders(headers, cookieStore.toString());
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
  const readable = await filterReadableCollections(config, user);
  const readableSlugs = new Set(readable.map((c) => c.slug));
  const visibleCollections = collections.filter((c) => readableSlugs.has(c.slug));
  // Lets the tab send presence heartbeats without a session lookup per beat (renewed by the client).
  const presenceToken = config.presence === false ? null : await signPresenceToken(resolveSecret(config), { id: user.id, name: user.name ?? null, email: user.email });
  const shell = (children: ReactNode) => (
    <AdminRoot {...root} collections={visibleCollections} user={userInfo} presenceToken={presenceToken}>
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
    if (!readableSlugs.has(slug)) return shell(<AccessDenied base={base} label={client.labels.plural.toLowerCase()} />);

    if (id === "new") {
      const canCreate = collection.access?.create ? Boolean(await collection.access.create({ user })) : true;
      if (!canCreate) return shell(<AccessDenied base={base} label={`new ${client.labels.plural.toLowerCase()}`} />);
      return shell(<DocumentEditor key="new" collection={client} doc={null} />);
    }
    if (id) {
      try {
        const doc = await loadAdminDoc(xenon, config, slug, id, user);
        if (!doc) notFound();
        return shell(<DocumentEditor key={doc.id} collection={client} doc={doc} />);
      } catch (err) {
        if (isXenonError(err) && err.code === "FORBIDDEN") return shell(<AccessDenied base={base} label={client.labels.plural.toLowerCase()} />);
        throw err;
      }
    }

    const q = first(query.q)?.trim() ?? "";
    const status = first(query.status);
    const page = Math.max(1, Number.parseInt(first(query.page) ?? "1", 10) || 1);
    const sort = resolveAdminSort(collection, first(query.sort));
    const and: Where[] = [];
    if (status === "draft" || status === "published") and.push({ status: { equals: status } });
    if (q) {
      const titleKey = client.admin.useAsTitle;
      and.push({ or: [...(titleKey ? [{ [titleKey]: { contains: q } }] : []), { slug: { contains: q } }, ...(client.upload ? [{ filename: { contains: q } }] : [])] });
    }
    try {
      const res = await xenon.find({
        ...ctx,
        collection: slug,
        draft: true,
        where: and.length ? { and } : undefined,
        sort,
        limit: PAGE_SIZE,
        page,
      });
      const changed = client.drafts ? await unpublishedChangesOnPage(config.db, slug, res.docs) : undefined;
      return shell(
        <CollectionListView
          key={slug}
          collection={client}
          rows={res.docs.map((d) => {
            const doc = d as Record<string, unknown>;
            return {
              ...toSummary(collection, doc),
              changed: changed?.has(d.id),
              values: Object.fromEntries(client.fields.map((f) => [f.name, doc[f.name] ?? null])),
            };
          })}
          totalDocs={res.totalDocs}
          page={res.page}
          totalPages={res.totalPages}
          query={{ q, status: status ?? "all", sort }}
        />,
      );
    } catch (err) {
      if (isXenonError(err) && err.code === "FORBIDDEN") return shell(<AccessDenied base={base} label={client.labels.plural.toLowerCase()} />);
      throw err;
    }
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
      tab === "team" ? dispatchAdminAction(config, { type: "users.list" }, sessionHeaders) : null,
      tab === "profile" ? dispatchAdminAction(config, { type: "account.sessions" }, sessionHeaders) : null,
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
