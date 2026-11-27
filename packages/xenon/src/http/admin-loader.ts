import type { Where } from "../adapters/types";
import { resolveSecret } from "../auth";
import { isXenonError } from "../core/errors";
import { type AnyGlobal, getGlobal } from "../core/global";
import {
  type AnyCollection,
  SYSTEM_KEYS,
  type SystemFields,
  UPLOAD_KEYS,
  type XenonConfig,
  type XenonUser,
} from "../core/types";
import { signPresenceToken } from "../server/presence";
import type { XenonInstance } from "../server/types";
import { type ClientCollection, type ClientGlobal, toClientCollection, toClientGlobal } from "../ui/shared/client-config";
import {
  type AccountSession,
  type AdminDoc,
  type AdminListRow,
  adminRoutes,
  type AdminTeamMember,
  type AdminTheme,
  type AdminUserInfo,
  type DashboardData,
  type SettingsTab,
} from "../ui/shared/services";
import {
  countUsers,
  dispatchAdminAction,
  getHttpXenon,
  loadAdminDoc,
  loadAdminGlobal,
  toSummary,
} from "./admin-action";
import { loadDashboard } from "./dashboard-data";

/**
 * Shared server-side admin route loader.
 * Used identically by both Next.js RSC (`AdminPage`) and HTTP `GET /{api}/_admin/data`
 * so both transports return the exact same payloads and enforce identical access checks.
 */

const PAGE_SIZE = 25;
const SYSTEM_SORT_KEYS = new Set<string>(SYSTEM_KEYS);
const UPLOAD_SORT_KEYS = new Set<string>(UPLOAD_KEYS);

export interface AdminShellPayload {
  theme: AdminTheme;
  basePath: string;
  apiPath: string;
  collections: ClientCollection[];
  globals?: ClientGlobal[];
  user: AdminUserInfo | null;
  presenceToken: string | null;
  /** `true` when the configured storage adapter supports direct presigned uploads. */
  presignedUploads?: boolean;
}

export type AdminRouteData =
  | { kind: "redirect"; to: string; status: 302 }
  | { kind: "not-found"; shell?: AdminShellPayload }
  | { kind: "auth"; mode: "setup" | "login"; shell: AdminShellPayload }
  | { kind: "access-denied"; label: string; shell: AdminShellPayload }
  | { kind: "dashboard"; data: DashboardData; shell: AdminShellPayload }
  | {
      kind: "collection-list";
      collection: ClientCollection;
      rows: AdminListRow[];
      totalDocs: number;
      page: number;
      totalPages: number;
      query: { q: string; status: string; sort: string };
      shell: AdminShellPayload;
    }
  | {
      kind: "document-new";
      collection: ClientCollection;
      shell: AdminShellPayload;
    }
  | {
      kind: "document-edit";
      collection: ClientCollection;
      doc: AdminDoc;
      shell: AdminShellPayload;
    }
  | {
      kind: "global-edit";
      global: ClientGlobal;
      doc: AdminDoc | null;
      shell: AdminShellPayload;
    }
  | {
      kind: "settings";
      tab: SettingsTab;
      users: AdminTeamMember[];
      sessions: AccountSession[];
      shell: AdminShellPayload;
    };

export interface LoadAdminDataOptions {
  config: XenonConfig;
  /** Reuse a specific Local API instance (e.g. `getXenon(config)` in Next.js). */
  xenon?: XenonInstance;
  /** Path segments relative to `config.admin.path`. */
  segments: readonly string[];
  /** Query string parameters for the route (e.g. `q`, `status`, `page`, `sort`). */
  query?: URLSearchParams | Record<string, string | string[] | undefined>;
  /** Incoming request headers (for session authentication and theme cookie). */
  headers: Headers;
  /** Explicit theme override (used when the host already parsed cookies). */
  theme?: AdminTheme;
}

function queryValue(
  query: LoadAdminDataOptions["query"],
  key: string,
): string | undefined {
  if (!query) return undefined;
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined;
  const raw = query[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Parses `xenon-theme` from a raw `Cookie` header. */
export function parseThemeCookie(cookieHeader: string | null): AdminTheme {
  if (!cookieHeader) return "system";
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== "xenon-theme") continue;
    const value = part.slice(eq + 1).trim();
    if (value === "light" || value === "dark" || value === "system") return value;
  }
  return "system";
}

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

export async function canReadGlobal(global: AnyGlobal, user: XenonUser): Promise<boolean> {
  const fn = global.access?.read;
  if (!fn) return true;
  return Boolean(await fn({ user }));
}

export async function filterReadableGlobals(config: XenonConfig, user: XenonUser): Promise<AnyGlobal[]> {
  const checked = await Promise.all((config.globals ?? []).map(async (g) => ((await canReadGlobal(g, user)) ? g : null)));
  return checked.filter((g): g is AnyGlobal => g !== null);
}

/** Look up working copies only for published documents on this access-checked page. */
export async function unpublishedChangesOnPage(db: XenonConfig["db"], collection: string, docs: readonly Pick<SystemFields, "id" | "status">[]) {
  const ids = docs.filter((doc) => doc.status === "published").map((doc) => doc.id);
  if (!db || !ids.length) return new Set<string>();
  const records = await db.find({ collection, source: "draft", where: { id: { in: ids } }, limit: ids.length });
  return new Set(records.docs.filter((doc) => doc.status === "published" && doc.draftData !== null).map((doc) => doc.id));
}

function normalizePathPrefix(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Resolves an admin path string (e.g. `"/admin/collections/posts?page=2"` or `"collections/posts"`)
 * into decoded route segments and optional inline query params.
 */
export function parseAdminPath(
  rawPath: string | null,
  basePath: string,
): { segments: string[]; query: URLSearchParams } | null {
  if (!rawPath) return { segments: [], query: new URLSearchParams() };
  const trimmed = rawPath.trim();
  // Reject scheme URLs or protocol-relative paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//") || trimmed.includes("\\")) return null;

  const qIndex = trimmed.indexOf("?");
  const pathnameRaw = qIndex >= 0 ? trimmed.slice(0, qIndex) : trimmed;
  const inlineQuery = new URLSearchParams(qIndex >= 0 ? trimmed.slice(qIndex + 1) : "");
  const normalizedBase = normalizePathPrefix(basePath);

  let relative = pathnameRaw.startsWith("/") ? pathnameRaw : `/${pathnameRaw}`;
  if (normalizedBase && (relative === normalizedBase || relative.startsWith(`${normalizedBase}/`))) {
    relative = relative.slice(normalizedBase.length);
  }
  const parts = relative.split("/").filter(Boolean);
  const segments: string[] = [];
  for (const part of parts) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (decoded === "." || decoded === "..") return null;
    segments.push(decoded);
  }
  return { segments, query: inlineQuery };
}

/**
 * Loads the complete data payload for any admin route.
 * Re-verifies the user's session on every call; API-key principals are treated as unauthenticated.
 */
export async function loadAdminData(options: LoadAdminDataOptions): Promise<AdminRouteData> {
  const { config, segments, query, headers } = options;
  const xenon = options.xenon ?? getHttpXenon(config);
  await xenon.init();

  const base = config.admin.path;
  const theme = options.theme ?? parseThemeCookie(headers.get("cookie"));
  const scheduling = typeof config.db?.findDue === "function";
  const allCollections = config.collections.map((c) => toClientCollection(c, { scheduling }));
  const allGlobals = (config.globals ?? []).map(toClientGlobal);
  const [section, slug, id, ...rest] = segments;

  const user = await xenon.getUser(headers);

  // ------------------------------------------------------------------ auth screens
  if (!user || user.id.startsWith("apikey:")) {
    const needsSetup = (await countUsers(xenon)) === 0;
    if (needsSetup && section !== "setup") return { kind: "redirect", to: adminRoutes.setup(base), status: 302 };
    if (!needsSetup && section !== "login") return { kind: "redirect", to: adminRoutes.login(base), status: 302 };
    return {
      kind: "auth",
      mode: needsSetup ? "setup" : "login",
      shell: {
        theme,
        basePath: base,
        apiPath: config.api.path,
        collections: [],
        globals: [],
        user: null,
        presenceToken: null,
        presignedUploads: false,
      },
    };
  }
  if (section === "login" || section === "setup") {
    return { kind: "redirect", to: adminRoutes.dashboard(base), status: 302 };
  }

  const userInfo: AdminUserInfo = { id: user.id, email: user.email, name: user.name ?? null, role: user.role };
  const ctx = { user, overrideAccess: false } as const;
  const [readable, readableGlobals] = await Promise.all([
    filterReadableCollections(config, user),
    filterReadableGlobals(config, user),
  ]);
  const readableSlugs = new Set(readable.map((c) => c.slug));
  const readableGlobalSlugs = new Set(readableGlobals.map((g) => g.slug));
  const visibleCollections = allCollections.filter((c) => readableSlugs.has(c.slug));
  const visibleGlobals = allGlobals.filter((g) => readableGlobalSlugs.has(g.slug));
  const presenceToken = config.presence === false
    ? null
    : await signPresenceToken(resolveSecret(config), { id: user.id, name: user.name ?? null, email: user.email });
  const shell: AdminShellPayload = {
    theme,
    basePath: base,
    apiPath: config.api.path,
    collections: visibleCollections,
    globals: visibleGlobals,
    user: userInfo,
    presenceToken,
    presignedUploads: xenon.supportsPresignedUploads,
  };

  // ------------------------------------------------------------------ dashboard
  if (!section) {
    return { kind: "dashboard", data: await loadDashboard(xenon, config, user), shell };
  }

  // ------------------------------------------------------------------ collections
  if (section === "collections" && slug) {
    const collection = xenon.getCollection(slug);
    const client = allCollections.find((c) => c.slug === slug);
    if (!collection || !client || rest.length > 0) return { kind: "not-found", shell };
    if (!readableSlugs.has(slug)) {
      return { kind: "access-denied", label: client.labels.plural.toLowerCase(), shell };
    }

    if (id === "new") {
      const canCreate = collection.access?.create ? Boolean(await collection.access.create({ user })) : true;
      if (!canCreate) {
        return { kind: "access-denied", label: `new ${client.labels.plural.toLowerCase()}`, shell };
      }
      return { kind: "document-new", collection: client, shell };
    }
    if (id) {
      try {
        const doc = await loadAdminDoc(xenon, config, slug, id, user);
        if (!doc) return { kind: "not-found", shell };
        return { kind: "document-edit", collection: client, doc, shell };
      } catch (err) {
        if (isXenonError(err) && err.code === "FORBIDDEN") {
          return { kind: "access-denied", label: client.labels.plural.toLowerCase(), shell };
        }
        throw err;
      }
    }

    const q = queryValue(query, "q")?.trim() ?? "";
    const status = queryValue(query, "status");
    const page = Math.max(1, Number.parseInt(queryValue(query, "page") ?? "1", 10) || 1);
    const sort = resolveAdminSort(collection, queryValue(query, "sort"));
    const and: Where[] = [];
    if (status === "draft" || status === "published") and.push({ status: { equals: status } });
    if (q) {
      const titleKey = client.admin.useAsTitle;
      and.push({
        or: [
          ...(titleKey ? [{ [titleKey]: { contains: q } }] : []),
          { slug: { contains: q } },
          ...(client.upload ? [{ filename: { contains: q } }] : []),
        ],
      });
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
      const rows: AdminListRow[] = res.docs.map((d) => {
        const doc = d as Record<string, unknown>;
        return {
          ...toSummary(collection, doc),
          changed: changed?.has(d.id),
          values: Object.fromEntries(client.fields.map((f) => [f.name, doc[f.name] ?? null])),
        };
      });
      return {
        kind: "collection-list",
        collection: client,
        rows,
        totalDocs: res.totalDocs,
        page: res.page,
        totalPages: res.totalPages,
        query: { q, status: status ?? "all", sort },
        shell,
      };
    } catch (err) {
      if (isXenonError(err) && err.code === "FORBIDDEN") {
        return { kind: "access-denied", label: client.labels.plural.toLowerCase(), shell };
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------ globals
  if (section === "globals" && slug) {
    const global = getGlobal(config, slug);
    const clientGlobal = allGlobals.find((g) => g.slug === slug);
    if (!global || !clientGlobal || id !== undefined) return { kind: "not-found", shell };
    if (!readableGlobalSlugs.has(slug)) {
      return { kind: "access-denied", label: clientGlobal.label.toLowerCase(), shell };
    }
    try {
      const doc = await loadAdminGlobal(xenon, config, slug, user);
      return { kind: "global-edit", global: clientGlobal, doc, shell };
    } catch (err) {
      if (isXenonError(err) && err.code === "FORBIDDEN") {
        return { kind: "access-denied", label: clientGlobal.label.toLowerCase(), shell };
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------ settings
  if (section === "account" && !slug) return { kind: "redirect", to: adminRoutes.settings(base), status: 302 };
  if (section === "users" && !slug) return { kind: "redirect", to: adminRoutes.settings(base, "team"), status: 302 };
  if (section === "settings" && !id) {
    const tab = (slug ?? "profile") as SettingsTab;
    if (!["profile", "appearance", "team"].includes(tab)) return { kind: "not-found", shell };
    if (tab === "team" && user.role !== "admin") return { kind: "redirect", to: adminRoutes.settings(base), status: 302 };
    const [users, sessions] = await Promise.all([
      tab === "team" ? dispatchAdminAction(config, { type: "users.list" }, headers, { xenon }) : null,
      tab === "profile" ? dispatchAdminAction(config, { type: "account.sessions" }, headers, { xenon }) : null,
    ]);
    return {
      kind: "settings",
      tab,
      users: users?.ok ? (users.data as AdminTeamMember[]) : [],
      sessions: sessions?.ok ? (sessions.data as AccountSession[]) : [],
      shell,
    };
  }

  return { kind: "not-found", shell };
}
