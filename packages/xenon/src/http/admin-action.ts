import { isXenonError, XenonError } from "../core/errors";
import { getGlobal } from "../core/global";
import type { AnyCollection, XenonConfig, XenonRole, XenonUser } from "../core/types";
import { type DocumentRecord, SlugConflictError, type Where } from "../adapters/types";
import { resolveSecret, toRole } from "../auth";
import { findGlobalRecord } from "../server/globals";
import { signPresenceToken } from "../server/presence";
import { createPreviewSession } from "../server/preview";
import type { XenonInstance } from "../server/types";
import { createXenon } from "../server/xenon";
import {
  documentSummaryTitle,
  type AccountSession, type ActionResult, type AdminDoc, type AdminUserInfo,
  type DocSummary, type PreviewInfo, type SearchInput, type SearchResult,
} from "../ui/shared/services";

/**
 * Framework-agnostic admin action contract and dispatcher.
 * Inputs are plain JSON. The session is re-validated on every call.
 * Used by both Next.js Server Actions (`runAdminAction`) and HTTP `POST /{api}/_admin/action`.
 */
export type AdminActionInput =
  | { type: "auth.login"; email: string; password: string }
  | { type: "auth.logout" }
  | { type: "auth.setup"; name: string; email: string; password: string }
  | { type: "doc.get"; collection: string; id: string }
  | { type: "doc.save"; collection: string; id?: string; data: Record<string, unknown>; draft: boolean; expectedUpdatedAt?: string; slug?: string | null }
  | { type: "doc.unpublish"; collection: string; id: string }
  | { type: "doc.remove"; collection: string; id: string }
  | ({ type: "doc.search" } & SearchInput)
  | { type: "global.get"; slug: string }
  | { type: "global.save"; slug: string; data: Record<string, unknown>; draft: boolean; expectedUpdatedAt?: string }
  | { type: "global.unpublish"; slug: string }
  | { type: "users.list" }
  | { type: "users.create"; name: string; email: string; password: string; role: XenonRole }
  | { type: "users.setRole"; userId: string; role: XenonRole }
  | { type: "users.setPassword"; userId: string; password: string }
  | { type: "users.remove"; userId: string }
  | { type: "account.update"; name: string }
  | { type: "account.changePassword"; currentPassword: string; newPassword: string }
  | { type: "account.sessions" }
  | { type: "account.revokeSession"; sessionId: string }
  | { type: "account.revokeOtherSessions" }
  | { type: "presence.token" }
  | { type: "preview.url"; kind: "collection" | "global"; slug: string; id?: string; data?: Record<string, unknown>; docSlug?: string | null };

export type AdminActionResult = ActionResult<unknown>;

export interface AdminActionExecution {
  result: AdminActionResult;
  /** Response headers emitted by BetterAuth (e.g. `Set-Cookie`) when dispatched over HTTP. */
  headers?: Headers;
}

export interface DispatchAdminActionOptions {
  /** Reuse a specific Local API instance (e.g. `getXenon(config)` in Next.js). */
  xenon?: XenonInstance;
  /** Capture `Set-Cookie` headers from BetterAuth calls (enabled for HTTP `/_admin/action`). */
  captureHeaders?: boolean;
  /** Whether API key principals are allowed. Default `true` for internal callers; `false` on HTTP `/_admin/action`. */
  allowApiKey?: boolean;
}

interface RawSession {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

type AnyApi = Record<string, (args: Record<string, unknown>) => Promise<any>>;

const defaultInstances = new WeakMap<XenonConfig, XenonInstance<XenonConfig>>();

/** Framework-agnostic memoized Local API instance (no `nextCookies` or `revalidateTag`). */
export function getHttpXenon<Cfg extends XenonConfig>(config: Cfg): XenonInstance<Cfg> {
  let xenon = defaultInstances.get(config);
  if (!xenon) {
    xenon = createXenon(config);
    defaultInstances.set(config, xenon);
  }
  return xenon as XenonInstance<Cfg>;
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function fail(error: unknown): ActionResult<never> {
  if (isXenonError(error)) {
    return { ok: false, error: { code: error.code, message: error.message, issues: error.issues } };
  }
  const e = error as { status?: unknown; body?: { message?: string; code?: string }; message?: string };
  // BetterAuth APIError
  if (e?.body?.message) {
    return { ok: false, error: { code: e.body.code ?? "BAD_REQUEST", message: e.body.message } };
  }
  console.error("[xenon] admin action failed:", error);
  return { ok: false, error: { code: "INTERNAL", message: "Something went wrong. Please try again." } };
}

/** Maps an `ActionResult` error code to an HTTP status for `POST /{api}/_admin/action`. */
export function actionErrorStatus(code: string): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "UNSUPPORTED_MEDIA_TYPE":
      return 415;
    case "NOT_IMPLEMENTED":
      return 501;
    case "INTERNAL":
      return 500;
    default:
      return 400;
  }
}

export function titleFieldKey(collection: AnyCollection): string | undefined {
  return collection.admin?.useAsTitle ?? Object.entries(collection.fields).find(([, f]) => f.type === "text")?.[0];
}

export function summaryTitle(collection: AnyCollection, data: Record<string, unknown>): string {
  return documentSummaryTitle(data, titleFieldKey(collection));
}

/** Converts a working-copy document from the Local API into the admin shape. */
/** Only a string (set by hand) or `null` (automatic) reaches the Local API; anything else is ignored. */
function slugInput(slug: unknown): { slug?: string | null } {
  return typeof slug === "string" || slug === null ? { slug } : {};
}

export function toAdminDoc(doc: Record<string, unknown>, record: DocumentRecord | null): AdminDoc {
  const { id, slug, status, createdAt, updatedAt, ...data } = doc;
  const meta = (record?.draftData ?? record?.data)?._slug as { manual?: boolean } | undefined;
  return {
    id: id as string,
    slug: (slug as string | null) ?? null,
    liveSlug: record?.slug ?? null,
    slugManual: meta?.manual === true,
    status: status as AdminDoc["status"],
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
    hasUnpublishedChanges: record ? record.status === "published" && record.draftData !== null : false,
    data,
  };
}

export function toSummary(collection: AnyCollection, doc: Record<string, unknown>): DocSummary {
  return {
    id: doc.id as string,
    title: summaryTitle(collection, doc),
    status: doc.status as DocSummary["status"],
    updatedAt: doc.updatedAt as string,
    url: typeof doc.url === "string" ? doc.url : null,
    mimeType: typeof doc.mimeType === "string" ? doc.mimeType : null,
    filename: typeof doc.filename === "string" ? doc.filename : null,
  };
}

export async function loadAdminDoc(xenon: XenonInstance, config: XenonConfig, collection: string, id: string, user: XenonUser) {
  const doc = await xenon.findById({ collection, id, draft: true, user, overrideAccess: false });
  if (!doc) return null;
  const record = (await config.db?.findById(collection, id)) ?? null;
  return toAdminDoc(doc as Record<string, unknown>, record);
}

export async function loadAdminGlobal(xenon: XenonInstance, config: XenonConfig, slug: string, user: XenonUser) {
  const doc = await xenon.getGlobal({ slug, draft: true, user, overrideAccess: false });
  if (!doc) return null;
  const record = config.db ? await findGlobalRecord(config.db, slug) : null;
  return toAdminDoc(doc as Record<string, unknown>, record);
}

const SETUP_COLLECTION = "_xenon_setup";
const SETUP_LOCK_SLUG = "lock";
/** A lock older than this with still no users is left behind by a crashed setup and may be taken over. */
const SETUP_LOCK_STALE_MS = 5 * 60_000;

/**
 * Claims the first-run setup. Returns a `release` callback that removes the lock so setup can be retried.
 * The row is `(collection "_xenon_setup", slug "lock")`: user collections can't start with `_`, so it can't collide.
 */
export async function claimSetup(config: XenonConfig, xenon?: XenonInstance): Promise<() => Promise<void>> {
  const db = config.db;
  if (!db) throw new XenonError("BAD_REQUEST", "Auth is not configured (no database).");
  const claim = () =>
    db.create({
      collection: SETUP_COLLECTION,
      slug: SETUP_LOCK_SLUG,
      status: "published",
      data: { claimedAt: new Date().toISOString() },
      draftData: null,
    });
  const lockFailed = () => new XenonError("FORBIDDEN", "Setup has already been completed.");

  let lock: Awaited<ReturnType<typeof claim>>;
  try {
    lock = await claim();
  } catch (err) {
    if (!(err instanceof SlugConflictError)) throw err;
    // Someone else holds the lock. Take it over only if it's stale and no user exists (a crashed setup).
    const { docs } = await db.find({
      collection: SETUP_COLLECTION,
      source: "published",
      where: { slug: { equals: SETUP_LOCK_SLUG } },
      limit: 1,
    });
    const existing = docs[0];
    if (!existing || Date.now() - existing.createdAt.getTime() <= SETUP_LOCK_STALE_MS) throw lockFailed();
    if ((await countUsers(xenon ?? getHttpXenon(config))) > 0) throw lockFailed();
    await db.delete(SETUP_COLLECTION, existing.id);
    try {
      lock = await claim();
    } catch (retryErr) {
      if (retryErr instanceof SlugConflictError) throw lockFailed();
      throw retryErr;
    }
  }
  return async () => {
    await db.delete(SETUP_COLLECTION, lock.id);
  };
}

export async function countUsers(xenon: XenonInstance): Promise<number> {
  const auth = await xenon.getAuth();
  if (!auth) return 0;
  return (await auth.$context).internalAdapter.countTotalUsers();
}

function requireString(value: unknown, field: string, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min) {
    throw new XenonError("VALIDATION", `Please check the ${field}.`, [{ path: [field], message: `${field} is required` }]);
  }
  return value.trim();
}

function requireRole(value: unknown): XenonRole {
  if (value !== "admin" && value !== "editor") throw new XenonError("BAD_REQUEST", "Unknown role.");
  return value;
}

/**
 * Merges the current cookie jar into the request headers.
 * When a Server Action rotates or clears the session cookie (e.g. changing password or signing out),
 * `headers()` still holds the incoming request while `cookies()` reflects the updated cookies.
 */
export function mergeSessionHeaders(headers: Headers, cookieHeader: string): Headers {
  const merged = new Headers(headers);
  if (cookieHeader) merged.set("cookie", cookieHeader);
  else merged.delete("cookie");
  return merged;
}

const USER_LIST_PAGE_SIZE = 200;
const USER_LIST_MAX = 10_000;

interface RawAdminUser {
  id: string;
  email: string;
  name?: string | null;
  role?: string | null;
  createdAt: Date | string;
}

/** Page through BetterAuth `listUsers` so large teams aren't silently truncated at 200. */
export async function listAllUsers(
  listUsers: (args: { query: { limit: number; offset: number; sortBy: string; sortDirection: string }; headers: Headers }) => Promise<{ users?: RawAdminUser[]; total?: number }>,
  headers: Headers,
  pageSize = USER_LIST_PAGE_SIZE,
  maxUsers = USER_LIST_MAX,
): Promise<(AdminUserInfo & { createdAt: string })[]> {
  const step = Math.max(1, pageSize);
  const byId = new Map<string, AdminUserInfo & { createdAt: string }>();
  let offset = 0;
  let truncated = false;
  while (byId.size < maxUsers) {
    const limit = Math.min(step, maxUsers - byId.size);
    const res = await listUsers({ query: { limit, offset, sortBy: "createdAt", sortDirection: "asc" }, headers });
    const batch = res.users ?? [];
    for (const u of batch) {
      if (byId.size >= maxUsers && !byId.has(u.id)) {
        truncated = true;
        break;
      }
      byId.set(u.id, {
        id: u.id,
        email: u.email,
        name: u.name ?? null,
        role: toRole(u.role),
        createdAt: new Date(u.createdAt).toISOString(),
      });
    }
    const total = typeof res.total === "number" ? res.total : undefined;
    const moreRemaining = total !== undefined ? offset + batch.length < total : batch.length === limit;
    if (batch.length === 0 || !moreRemaining) break;
    offset += batch.length;
    if (byId.size >= maxUsers) {
      truncated = true;
      break;
    }
  }
  if (truncated) {
    console.warn(`[xenon] users.list reached maximum safety limit (${maxUsers}); remaining users were omitted.`);
  }
  return [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function requestOriginFromHeaders(headers: Headers): string | undefined {
  const origin = headers.get("origin");
  if (origin) return origin;
  const referer = headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore malformed Referer headers.
    }
  }
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
    return `${proto}://${host}`;
  }
  return undefined;
}

function copySetCookies(source: Headers | undefined, target: Headers): void {
  if (!source) return;
  const cookies = typeof source.getSetCookie === "function" ? source.getSetCookie() : [];
  if (cookies.length) {
    for (const cookie of cookies) target.append("set-cookie", cookie);
    return;
  }
  const single = source.get("set-cookie");
  if (single) target.append("set-cookie", single);
}

/**
 * Framework-agnostic admin action dispatcher that optionally captures `Set-Cookie` headers
 * emitted by BetterAuth (used by HTTP `POST /{api}/_admin/action`).
 */
export async function dispatchAdminActionWithHeaders(
  config: XenonConfig,
  input: AdminActionInput,
  headers: Headers,
  options: DispatchAdminActionOptions = {},
): Promise<AdminActionExecution> {
  const responseHeaders = options.captureHeaders ? new Headers() : undefined;
  const callAuth = async (fn: (args: Record<string, unknown>) => Promise<any>, args: Record<string, unknown>) => {
    if (!options.captureHeaders) return fn(args);
    const res = (await fn({ ...args, returnHeaders: true })) as { headers?: Headers; response?: unknown };
    if (res && typeof res === "object" && "headers" in res && res.headers instanceof Headers) {
      copySetCookies(res.headers, responseHeaders!);
      return res.response;
    }
    return res;
  };

  try {
    const xenon = options.xenon ?? getHttpXenon(config);
    const auth = await xenon.getAuth();
    if (!auth) throw new XenonError("BAD_REQUEST", "Auth is not configured (no database).");
    const api = auth.api as unknown as AnyApi;

    // ---- unauthenticated actions -------------------------------------------------------------
    if (input.type === "auth.login") {
      await callAuth(api.signInEmail!, {
        body: { email: requireString(input.email, "email"), password: requireString(input.password, "password") },
        headers,
      });
      return { result: ok(null), headers: responseHeaders };
    }
    if (input.type === "auth.setup") {
      if ((await countUsers(xenon)) > 0) throw new XenonError("FORBIDDEN", "Setup has already been completed.");
      const email = requireString(input.email, "email");
      const password = requireString(input.password, "password", 8);
      const name = requireString(input.name, "name");
      // Only one request may create the first admin. The lock row is a unique (collection, slug) insert, so
      // concurrent setups (any process, any adapter) can't both claim it. It stays after success, which keeps setup closed.
      const release = await claimSetup(config, xenon);
      try {
        // Re-check after claiming: a user created out of band between the first check and the claim must still fail closed.
        if ((await countUsers(xenon)) > 0) throw new XenonError("FORBIDDEN", "Setup has already been completed.");
        // Server-side call without a session: allowed by BetterAuth's admin plugin.
        await api.createUser!({ body: { email, password, name, role: "admin" } });
      } catch (err) {
        await release();
        throw err;
      }
      await callAuth(api.signInEmail!, { body: { email, password }, headers });
      return { result: ok(null), headers: responseHeaders };
    }

    const user = await xenon.getUser(headers);
    if (!user) throw new XenonError("UNAUTHORIZED", "Your session has expired. Please sign in again.");
    if (options.allowApiKey === false && user.id.startsWith("apikey:")) {
      throw new XenonError("FORBIDDEN", "Admin actions require a signed-in user session.");
    }
    const ctx = { user, overrideAccess: false } as const;
    const requireAdmin = () => {
      if (user.role !== "admin") throw new XenonError("FORBIDDEN", "Only admins can manage users.");
    };
    const collectionOf = (slug: string) => {
      const c = xenon.getCollection(slug);
      if (!c) throw new XenonError("NOT_FOUND", `Unknown collection "${slug}".`);
      return c;
    };

    switch (input.type) {
      case "auth.logout":
        await callAuth(api.signOut!, { headers });
        return { result: ok(null), headers: responseHeaders };

      case "doc.get": {
        const doc = await loadAdminDoc(xenon, config, input.collection, input.id, user);
        if (!doc) throw new XenonError("NOT_FOUND", "This document no longer exists.");
        return { result: ok(doc), headers: responseHeaders };
      }

      case "doc.save": {
        collectionOf(input.collection);
        const doc = input.id
          ? await xenon.update({
              ...ctx, collection: input.collection, id: input.id, data: input.data as never, draft: input.draft,
              expectedUpdatedAt: typeof input.expectedUpdatedAt === "string" ? input.expectedUpdatedAt : undefined,
              ...slugInput(input.slug),
            })
          : await xenon.create({ ...ctx, collection: input.collection, data: input.data as never, draft: input.draft, ...slugInput(input.slug) });
        const id = (doc as { id: string }).id;
        return { result: ok(await loadAdminDoc(xenon, config, input.collection, id, user)), headers: responseHeaders };
      }

      case "presence.token": {
        if (config.presence === false || user.id.startsWith("apikey:")) throw new XenonError("NOT_FOUND", "Presence is turned off.");
        return { result: ok(await signPresenceToken(resolveSecret(config), { id: user.id, name: user.name ?? null, email: user.email })), headers: responseHeaders };
      }

      case "preview.url": {
        if (input.kind !== "collection" && input.kind !== "global") {
          throw new XenonError("BAD_REQUEST", "Invalid preview target kind.");
        }
        const session = await createPreviewSession(config, xenon, {
          kind: input.kind,
          slug: requireString(input.slug, "slug"),
          id: typeof input.id === "string" && input.id ? input.id : undefined,
          data: input.data && typeof input.data === "object" && !Array.isArray(input.data) ? input.data : undefined,
          docSlug: input.docSlug === null || typeof input.docSlug === "string" ? input.docSlug : undefined,
          user,
          requestUrl: requestOriginFromHeaders(headers),
        });
        const info: PreviewInfo | null = session
          ? { url: session.url, enterUrl: session.enterUrl, targetOrigin: session.targetOrigin }
          : null;
        return { result: ok(info), headers: responseHeaders };
      }

      case "doc.unpublish": {
        await xenon.unpublish({ ...ctx, collection: input.collection, id: input.id });
        return { result: ok(await loadAdminDoc(xenon, config, input.collection, input.id, user)), headers: responseHeaders };
      }

      case "doc.remove": {
        await xenon.delete({ ...ctx, collection: input.collection, id: input.id });
        return { result: ok({ id: input.id }), headers: responseHeaders };
      }

      case "global.get": {
        if (!getGlobal(config, input.slug)) throw new XenonError("NOT_FOUND", `Unknown global "${input.slug}".`);
        return { result: ok(await loadAdminGlobal(xenon, config, input.slug, user)), headers: responseHeaders };
      }

      case "global.save": {
        if (!getGlobal(config, input.slug)) throw new XenonError("NOT_FOUND", `Unknown global "${input.slug}".`);
        await xenon.updateGlobal({
          ...ctx,
          slug: input.slug,
          data: input.data as never,
          draft: input.draft,
          expectedUpdatedAt: typeof input.expectedUpdatedAt === "string" ? input.expectedUpdatedAt : undefined,
        });
        return { result: ok(await loadAdminGlobal(xenon, config, input.slug, user)), headers: responseHeaders };
      }

      case "global.unpublish": {
        if (!getGlobal(config, input.slug)) throw new XenonError("NOT_FOUND", `Unknown global "${input.slug}".`);
        await xenon.unpublishGlobal({ ...ctx, slug: input.slug });
        return { result: ok(await loadAdminGlobal(xenon, config, input.slug, user)), headers: responseHeaders };
      }

      case "doc.search": {
        const collection = collectionOf(input.collection);
        const limit = Math.min(Math.max(1, input.limit ?? 24), 100);
        // '/' immediately precedes '0' in binary string order. This range matches the image/ prefix.
        const where: Where = input.imagesOnly === true ? { mimeType: { gte: "image/", lt: "image0" } } : {};
        if (input.ids) {
          const ids = input.ids.filter((v) => typeof v === "string").slice(0, 200);
          if (ids.length === 0) return { result: ok<SearchResult>({ docs: [], totalDocs: 0, page: 1, hasNextPage: false }), headers: responseHeaders };
          const res = await xenon.find({ ...ctx, collection: input.collection, draft: true, where: { ...where, id: { in: ids } }, limit: ids.length });
          const byId = new Map(res.docs.map((d) => [(d as { id: string }).id, d]));
          const docs = ids.flatMap((id) => (byId.has(id) ? [toSummary(collection, byId.get(id) as Record<string, unknown>)] : []));
          return { result: ok<SearchResult>({ docs, totalDocs: docs.length, page: 1, hasNextPage: false }), headers: responseHeaders };
        }
        const q = input.query?.trim().slice(0, 500);
        const res = await xenon.find({
          ...ctx,
          collection: input.collection,
          draft: true,
          where: Object.keys(where).length ? where : undefined,
          search: q || undefined,
          sort: q ? undefined : "-updatedAt",
          limit,
          page: input.page ?? 1,
        });
        return {
          result: ok<SearchResult>({
            docs: res.docs.map((d) => toSummary(collection, d as Record<string, unknown>)),
            totalDocs: res.totalDocs,
            page: res.page,
            hasNextPage: res.hasNextPage,
          }),
          headers: responseHeaders,
        };
      }

      case "users.list": {
        requireAdmin();
        const users = await listAllUsers(
          api.listUsers! as Parameters<typeof listAllUsers>[0],
          headers,
        );
        return { result: ok(users), headers: responseHeaders };
      }

      case "users.create": {
        requireAdmin();
        await api.createUser!({
          body: {
            name: requireString(input.name, "name"),
            email: requireString(input.email, "email"),
            password: requireString(input.password, "password", 8),
            role: requireRole(input.role),
          },
          headers,
        });
        return { result: ok(null), headers: responseHeaders };
      }

      case "users.setRole": {
        requireAdmin();
        if (input.userId === user.id) throw new XenonError("BAD_REQUEST", "You can't change your own role.");
        await api.setRole!({ body: { userId: input.userId, role: requireRole(input.role) }, headers });
        return { result: ok(null), headers: responseHeaders };
      }

      case "users.setPassword": {
        requireAdmin();
        await api.setUserPassword!({
          body: { userId: input.userId, newPassword: requireString(input.password, "password", 8) },
          headers,
        });
        return { result: ok(null), headers: responseHeaders };
      }

      case "users.remove": {
        requireAdmin();
        if (input.userId === user.id) throw new XenonError("BAD_REQUEST", "You can't remove your own account.");
        await api.removeUser!({ body: { userId: input.userId }, headers });
        return { result: ok(null), headers: responseHeaders };
      }

      case "account.update": {
        await api.updateUser!({ body: { name: requireString(input.name, "name") }, headers });
        return { result: ok(null), headers: responseHeaders };
      }

      case "account.changePassword": {
        await callAuth(api.changePassword!, {
          body: {
            currentPassword: requireString(input.currentPassword, "currentPassword"),
            newPassword: requireString(input.newPassword, "newPassword", 8),
            revokeOtherSessions: true,
          },
          headers,
        });
        return { result: ok(null), headers: responseHeaders };
      }

      case "account.sessions": {
        const [current, sessions] = await Promise.all([api.getSession!({ headers }), api.listSessions!({ headers })]);
        const currentId = (current as { session?: { id?: string } } | null)?.session?.id;
        const list = (sessions as RawSession[])
          .map((s): AccountSession => ({
            id: s.id,
            current: s.id === currentId,
            userAgent: s.userAgent ?? null,
            ipAddress: s.ipAddress ?? null,
            createdAt: new Date(s.createdAt).toISOString(),
            updatedAt: new Date(s.updatedAt).toISOString(),
          }))
          .sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt.localeCompare(a.updatedAt));
        return { result: ok(list), headers: responseHeaders };
      }

      case "account.revokeSession": {
        // Tokens never leave the server: resolve the id against the caller's own sessions.
        const sessions = (await api.listSessions!({ headers })) as RawSession[];
        const target = sessions.find((s) => s.id === input.sessionId);
        if (!target) throw new XenonError("NOT_FOUND", "That session has already ended.");
        await callAuth(api.revokeSession!, { body: { token: target.token }, headers });
        return { result: ok(null), headers: responseHeaders };
      }

      case "account.revokeOtherSessions": {
        await callAuth(api.revokeOtherSessions!, { headers });
        return { result: ok(null), headers: responseHeaders };
      }

      default:
        throw new XenonError("BAD_REQUEST", "Unknown action.");
    }
  } catch (error) {
    return { result: fail(error), headers: responseHeaders };
  }
}

/** Dispatches an admin action with explicit headers (framework-agnostic). */
export async function dispatchAdminAction(
  config: XenonConfig,
  input: AdminActionInput,
  headers: Headers,
  options?: DispatchAdminActionOptions,
): Promise<AdminActionResult> {
  const { result } = await dispatchAdminActionWithHeaders(config, input, headers, options);
  return result;
}
