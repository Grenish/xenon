import { headers as nextHeaders } from "next/headers";
import { isXenonError, XenonError } from "../../core/errors";
import type { AnyCollection, XenonConfig, XenonRole, XenonUser } from "../../core/types";
import type { DocumentRecord } from "../../adapters/types";
import type { XenonInstance } from "../../server/types";
import type { AccountSession, ActionResult, AdminDoc, AdminUserInfo, DocSummary, SearchResult } from "../../ui/shared/services";
import { resolveSecret, toRole } from "../../auth";
import { signPresenceToken } from "../../server/presence";
import { getXenon } from "../xenon";

/**
 * Every admin mutation/query goes through one user-land Server Action that calls `runAdminAction`.
 * Inputs are plain JSON. The session is re-validated on every call.
 */
export type AdminActionInput =
  | { type: "auth.login"; email: string; password: string }
  | { type: "auth.logout" }
  | { type: "auth.setup"; name: string; email: string; password: string }
  | { type: "doc.get"; collection: string; id: string }
  | { type: "doc.save"; collection: string; id?: string; data: Record<string, unknown>; draft: boolean; expectedUpdatedAt?: string }
  | { type: "doc.unpublish"; collection: string; id: string }
  | { type: "doc.remove"; collection: string; id: string }
  | { type: "doc.search"; collection: string; query?: string; page?: number; limit?: number; ids?: string[] }
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
  | { type: "presence.token" };

export type AdminActionResult = ActionResult<unknown>;

interface RawSession {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

type AnyApi = Record<string, (args: Record<string, unknown>) => Promise<any>>;

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

export function summaryTitle(collection: AnyCollection, data: Record<string, unknown>): string {
  const key = collection.admin?.useAsTitle ?? Object.entries(collection.fields).find(([, f]) => f.type === "text")?.[0];
  const value = key ? data[key] : undefined;
  if (typeof value === "string" && value.trim()) return value;
  if (typeof data.filename === "string") return data.filename;
  return "Untitled";
}

/** Converts a working-copy document from the Local API into the admin shape. */
export function toAdminDoc(doc: Record<string, unknown>, record: DocumentRecord | null): AdminDoc {
  const { id, slug, status, createdAt, updatedAt, ...data } = doc;
  return {
    id: id as string,
    slug: (slug as string | null) ?? null,
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
 * Dispatches an admin action. Call it from a user-land `"use server"` function:
 * `async function action(input) { "use server"; return runAdminAction(config, input); }`
 */
export async function runAdminAction(config: XenonConfig, input: AdminActionInput): Promise<AdminActionResult> {
  try {
    const xenon = getXenon(config);
    const auth = await xenon.getAuth();
    if (!auth) throw new XenonError("BAD_REQUEST", "Auth is not configured (no database).");
    const api = auth.api as unknown as AnyApi;
    const headers = await nextHeaders();

    // ---- unauthenticated actions -------------------------------------------------------------
    if (input.type === "auth.login") {
      await api.signInEmail!({
        body: { email: requireString(input.email, "email"), password: requireString(input.password, "password") },
        headers,
      });
      return ok(null);
    }
    if (input.type === "auth.setup") {
      if ((await countUsers(xenon)) > 0) throw new XenonError("FORBIDDEN", "Setup has already been completed.");
      const email = requireString(input.email, "email");
      const password = requireString(input.password, "password", 8);
      // Server-side call without a session: allowed by BetterAuth's admin plugin.
      await api.createUser!({ body: { email, password, name: requireString(input.name, "name"), role: "admin" } });
      await api.signInEmail!({ body: { email, password }, headers });
      return ok(null);
    }

    const user = await xenon.getUser(headers);
    if (!user) throw new XenonError("UNAUTHORIZED", "Your session has expired. Please sign in again.");
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
        await api.signOut!({ headers });
        return ok(null);

      case "doc.get": {
        const doc = await loadAdminDoc(xenon, config, input.collection, input.id, user);
        if (!doc) throw new XenonError("NOT_FOUND", "This document no longer exists.");
        return ok(doc);
      }

      case "doc.save": {
        collectionOf(input.collection);
        const doc = input.id
          ? await xenon.update({
              ...ctx, collection: input.collection, id: input.id, data: input.data as never, draft: input.draft,
              expectedUpdatedAt: typeof input.expectedUpdatedAt === "string" ? input.expectedUpdatedAt : undefined,
            })
          : await xenon.create({ ...ctx, collection: input.collection, data: input.data as never, draft: input.draft });
        const id = (doc as { id: string }).id;
        return ok(await loadAdminDoc(xenon, config, input.collection, id, user));
      }

      case "presence.token": {
        if (config.presence === false || user.id.startsWith("apikey:")) throw new XenonError("NOT_FOUND", "Presence is turned off.");
        return ok(await signPresenceToken(resolveSecret(config), { id: user.id, name: user.name ?? null, email: user.email }));
      }

      case "doc.unpublish": {
        await xenon.unpublish({ ...ctx, collection: input.collection, id: input.id });
        return ok(await loadAdminDoc(xenon, config, input.collection, input.id, user));
      }

      case "doc.remove": {
        await xenon.delete({ ...ctx, collection: input.collection, id: input.id });
        return ok({ id: input.id });
      }

      case "doc.search": {
        const collection = collectionOf(input.collection);
        const limit = Math.min(Math.max(1, input.limit ?? 24), 100);
        if (input.ids) {
          const ids = input.ids.filter((v) => typeof v === "string").slice(0, 200);
          if (ids.length === 0) return ok<SearchResult>({ docs: [], totalDocs: 0, page: 1, hasNextPage: false });
          const res = await xenon.find({ ...ctx, collection: input.collection, draft: true, where: { id: { in: ids } }, limit: 0 });
          const byId = new Map(res.docs.map((d) => [(d as { id: string }).id, d]));
          const docs = ids.flatMap((id) => (byId.has(id) ? [toSummary(collection, byId.get(id) as Record<string, unknown>)] : []));
          return ok<SearchResult>({ docs, totalDocs: docs.length, page: 1, hasNextPage: false });
        }
        const titleKey = collection.admin?.useAsTitle;
        const q = input.query?.trim();
        const where = q
          ? { or: [...(titleKey ? [{ [titleKey]: { contains: q } }] : []), { slug: { contains: q } }, { filename: { contains: q } }] }
          : undefined;
        const res = await xenon.find({
          ...ctx,
          collection: input.collection,
          draft: true,
          where,
          sort: "-updatedAt",
          limit,
          page: input.page ?? 1,
        });
        return ok<SearchResult>({
          docs: res.docs.map((d) => toSummary(collection, d as Record<string, unknown>)),
          totalDocs: res.totalDocs,
          page: res.page,
          hasNextPage: res.hasNextPage,
        });
      }

      case "users.list": {
        requireAdmin();
        const res = await api.listUsers!({ query: { limit: 200, sortBy: "createdAt", sortDirection: "asc" }, headers });
        const users: (AdminUserInfo & { createdAt: string })[] = (res.users ?? []).map(
          (u: { id: string; email: string; name?: string | null; role?: string | null; createdAt: Date | string }) => ({
            id: u.id,
            email: u.email,
            name: u.name ?? null,
            role: toRole(u.role),
            createdAt: new Date(u.createdAt).toISOString(),
          }),
        );
        return ok(users);
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
        return ok(null);
      }

      case "users.setRole": {
        requireAdmin();
        if (input.userId === user.id) throw new XenonError("BAD_REQUEST", "You can't change your own role.");
        await api.setRole!({ body: { userId: input.userId, role: requireRole(input.role) }, headers });
        return ok(null);
      }

      case "users.setPassword": {
        requireAdmin();
        await api.setUserPassword!({
          body: { userId: input.userId, newPassword: requireString(input.password, "password", 8) },
          headers,
        });
        return ok(null);
      }

      case "users.remove": {
        requireAdmin();
        if (input.userId === user.id) throw new XenonError("BAD_REQUEST", "You can't remove your own account.");
        await api.removeUser!({ body: { userId: input.userId }, headers });
        return ok(null);
      }

      case "account.update": {
        await api.updateUser!({ body: { name: requireString(input.name, "name") }, headers });
        return ok(null);
      }

      case "account.changePassword": {
        await api.changePassword!({
          body: {
            currentPassword: requireString(input.currentPassword, "currentPassword"),
            newPassword: requireString(input.newPassword, "newPassword", 8),
            revokeOtherSessions: true,
          },
          headers,
        });
        return ok(null);
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
        return ok(list);
      }

      case "account.revokeSession": {
        // Tokens never leave the server: resolve the id against the caller's own sessions.
        const sessions = (await api.listSessions!({ headers })) as RawSession[];
        const target = sessions.find((s) => s.id === input.sessionId);
        if (!target) throw new XenonError("NOT_FOUND", "That session has already ended.");
        await api.revokeSession!({ body: { token: target.token }, headers });
        return ok(null);
      }

      case "account.revokeOtherSessions": {
        await api.revokeOtherSessions!({ headers });
        return ok(null);
      }

      default:
        throw new XenonError("BAD_REQUEST", "Unknown action.");
    }
  } catch (error) {
    return fail(error);
  }
}
