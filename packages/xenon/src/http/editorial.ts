/**
 * REST routes for version history (#15) and scheduled publishing (#16):
 *
 *   GET  {api}/{collection}/{id}/versions                       ?limit&page
 *   GET  {api}/{collection}/{id}/versions/{versionId}
 *   POST {api}/{collection}/{id}/versions/{versionId}/restore   ?draft=false publishes; If-Match
 *   GET  {api}/{collection}/{id}/schedule
 *   PUT  {api}/{collection}/{id}/schedule                       { publishAt?, unpublishAt? }
 *   GET|POST {api}/_cron/publish                                Authorization: Bearer <cron secret>
 *
 * Every response is private (`no-store`): versions and schedules expose unpublished content.
 */
import { safeEqual } from "../auth";
import { XenonError } from "../core/errors";
import type { XenonConfig } from "../core/types";
import type { XenonInstance } from "../server/types";
import { PRIVATE_NO_STORE } from "./cache";

const NO_STORE = { "cache-control": PRIVATE_NO_STORE };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

/** `true` for `{collection}/{id}/versions…`, `…/schedule`, `…/restore` and `…/duplicate` paths. */
export function isEditorialRoute(segments: readonly string[]): boolean {
  if (segments.length === 3 && (segments[2] === "restore" || segments[2] === "duplicate")) return true;
  return segments.length >= 3 && (segments[2] === "versions" || segments[2] === "schedule");
}

/** `?trash=true` on a list: read the trash (#18). */
export function parseTrashParam(params: URLSearchParams): boolean {
  const raw = params.get("trash");
  if (raw === null || raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  throw new XenonError("BAD_REQUEST", "trash must be true or false.");
}

/** `?permanent=true` on DELETE: purge instead of moving to the trash (#18). */
export function parsePermanentParam(params: URLSearchParams): boolean {
  const raw = params.get("permanent");
  if (raw === null || raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  throw new XenonError("BAD_REQUEST", "permanent must be true or false.");
}

function intParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new XenonError("BAD_REQUEST", `${key} must be a positive integer.`);
  return n;
}

function draftParam(params: URLSearchParams): boolean | undefined {
  const raw = params.get("draft");
  if (raw === null) return undefined;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new XenonError("BAD_REQUEST", "draft must be true or false.");
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new XenonError("UNSUPPORTED_MEDIA_TYPE", "This endpoint requires application/json.");
  let body: unknown;
  try { body = await request.json(); } catch { throw new XenonError("BAD_REQUEST", "Invalid JSON body."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new XenonError("BAD_REQUEST", "Request body must be a JSON object.");
  return body as Record<string, unknown>;
}

function scheduleValue(body: Record<string, unknown>, key: "publishAt" | "unpublishAt"): string | null | undefined {
  if (!Object.hasOwn(body, key)) return undefined;
  const value = body[key];
  if (value === null || typeof value === "string") return value;
  throw new XenonError("BAD_REQUEST", `${key} must be an ISO date string or null.`);
}

export async function handleEditorialRoute(
  request: Request,
  segments: readonly string[],
  xenon: XenonInstance,
  helpers: { user: Awaited<ReturnType<XenonInstance["getUser"]>>; ifMatch?: string },
): Promise<Response> {
  const [collection, id, kind, versionId, action] = segments as [string, string, string, string?, string?];
  const shared = { collection, id, user: helpers.user, overrideAccess: false };
  const params = new URL(request.url).searchParams;
  const method = request.method;

  if (kind === "restore" && method === "POST") return json(await xenon.restore(shared));
  if (kind === "duplicate" && method === "POST") {
    const hasBody = request.headers.get("content-type") !== null;
    const body = hasBody ? await readJson(request) : {};
    if (body.data !== undefined && (typeof body.data !== "object" || body.data === null || Array.isArray(body.data))) {
      throw new XenonError("BAD_REQUEST", "data must be a JSON object.");
    }
    return json(await xenon.duplicate({ ...shared, data: body.data as never }), 201);
  }
  if (kind === "schedule" && segments.length === 3) {
    if (method === "GET") return json(await xenon.getSchedule(shared));
    if (method === "PUT" || method === "POST") {
      const body = await readJson(request);
      return json(await xenon.schedule({
        ...shared,
        publishAt: scheduleValue(body, "publishAt"),
        unpublishAt: scheduleValue(body, "unpublishAt"),
      }));
    }
  }
  if (kind === "versions") {
    if (segments.length === 3 && method === "GET") {
      return json(await xenon.findVersions({ ...shared, limit: intParam(params, "limit"), page: intParam(params, "page") }));
    }
    if (segments.length === 4 && method === "GET") {
      const version = await xenon.findVersionById({ ...shared, id: versionId! });
      if (!version || version.documentId !== id) throw new XenonError("NOT_FOUND", "Version not found.");
      return json(version);
    }
    if (segments.length === 5 && action === "restore" && method === "POST") {
      const version = await xenon.findVersionById({ ...shared, id: versionId! });
      if (!version || version.documentId !== id) throw new XenonError("NOT_FOUND", "Version not found.");
      return json(await xenon.restoreVersion({
        ...shared,
        id: versionId!,
        draft: draftParam(params),
        expectedUpdatedAt: helpers.ifMatch,
      }));
    }
  }
  throw new XenonError("NOT_FOUND", "Route not found.");
}

function cronSecret(config: XenonConfig): string | undefined {
  const env = typeof process !== "undefined" ? process.env : undefined;
  return config.cron?.secret || env?.XENON_CRON_SECRET || env?.CRON_SECRET || undefined;
}

/** `{api}/_cron/publish`: a cron secret bearer token, or an admin session / admin API key. */
export async function handleCronRoute(
  request: Request,
  segments: readonly string[],
  config: XenonConfig,
  xenon: XenonInstance,
  /** CSRF guard for cookie-authenticated POSTs. */
  requireTrustedOrigin: () => void,
): Promise<Response> {
  if (segments.length !== 2 || segments[1] !== "publish" || (request.method !== "GET" && request.method !== "POST")) {
    throw new XenonError("NOT_FOUND", "Route not found.");
  }
  const secret = cronSecret(config);
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  const bySecret = Boolean(secret && bearer && safeEqual(bearer, secret));
  if (!bySecret) {
    const user = await xenon.getUser(request.headers);
    if (!user) throw new XenonError("UNAUTHORIZED", "Cron requests need `Authorization: Bearer <cron secret>`.");
    if (user.role !== "admin") throw new XenonError("FORBIDDEN", "Only admins can run scheduled publishing.");
    if (request.method === "POST" && !bearer) requireTrustedOrigin();
  }
  return json(await xenon.runScheduled());
}
