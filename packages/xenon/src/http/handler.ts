import { resolveSecret } from "../auth";
import { isXenonError, XenonError } from "../core/errors";
import { getGlobal, GLOBALS_COLLECTION } from "../core/global";
import type { XenonConfig } from "../core/types";
import { populatesRestrictedCollection } from "../server/populate";
import { defaultPresenceStore, verifyPresenceToken } from "../server/presence";
import {
  buildPreviewCookie,
  clearPreviewCookie,
  createPreviewSession,
  PREVIEW_SESSION_TTL_MS,
  resolvePreviewUrl,
  signPreviewToken,
  verifyPreviewToken,
} from "../server/preview";
import type { UploadFile, XenonInstance } from "../server/types";
import { keySegments } from "../storage/keys";
import {
  actionErrorStatus,
  type AdminActionInput,
  dispatchAdminActionWithHeaders,
  getHttpXenon,
} from "./admin-action";
import { loadAdminData, parseAdminPath } from "./admin-loader";
import {
  computeEtag,
  jsonCachedResponse,
  matchesIfNoneMatch,
  PRIVATE_NO_STORE,
} from "./cache";
import { handleCronRoute, handleEditorialRoute, isEditorialRoute, parsePermanentParam, parseTrashParam } from "./editorial";
import { parseDraft, parseQuery, parseReadQuery } from "./query";

export interface CreateHandlerOptions<Cfg extends XenonConfig = XenonConfig> {
  /** Reuse a specific Local API instance (e.g. `getXenon(config)` in Next.js or a test instance). */
  xenon?: XenonInstance<Cfg>;
  /**
   * URL pathname prefix stripped before routing.
   * Defaults to `config.api.path` (typically `"/api/xenon"`).
   * Pass `""` or `"/"` when the host framework strips the mount prefix beforehand.
   */
  basePath?: string;
  /**
   * `Cache-Control` header for public, unrestricted, non-draft `GET` collection/document responses.
   * Defaults to `"public, max-age=0, must-revalidate"`.
   */
  cacheControl?: string;
}

export type XenonHttpHandler = (request: Request) => Promise<Response>;

type RuntimeInput = Parameters<XenonInstance["create"]>[0]["data"];

function objectData(input: unknown): RuntimeInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new XenonError("BAD_REQUEST", "Document data must be a JSON object.");
  }
  // This is the HTTP trust boundary; the Local API validates every field against its collection.
  return input as RuntimeInput;
}

const MAX_HTTP_PRESIGN_EXPIRES_SECONDS = 3600;

async function readJsonObject(request: Request, message = "Endpoint requires application/json."): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new XenonError("UNSUPPORTED_MEDIA_TYPE", message);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new XenonError("BAD_REQUEST", "Invalid JSON body.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new XenonError("BAD_REQUEST", "Request body must be a JSON object.");
  }
  return raw as Record<string, unknown>;
}

// Reserve room for document JSON, filenames, headers and multipart boundaries.
const MULTIPART_OVERHEAD = 1024 * 1024;

async function readForm(request: Request, maxFileSize?: number): Promise<FormData> {
  let remaining = maxFileSize === undefined ? Infinity : maxFileSize + MULTIPART_OVERHEAD;
  const limitMessage = "Multipart body exceeds the upload limit.";
  if (Number(request.headers.get("content-length")) > remaining) {
    void request.body?.cancel().catch(() => {});
    throw new XenonError("PAYLOAD_TOO_LARGE", limitMessage);
  }
  try {
    if (maxFileSize === undefined || !request.body) return await request.formData();
    const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        remaining -= chunk.byteLength;
        if (remaining < 0) throw new Error(limitMessage);
        controller.enqueue(chunk);
      },
    }));
    return await new Response(bounded, { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  } catch {
    if (remaining < 0) throw new XenonError("PAYLOAD_TOO_LARGE", limitMessage);
    throw new XenonError("BAD_REQUEST", "Invalid multipart body.");
  }
}

/**
 * Lifts a top-level `slug` out of the body into the Local API `slug` option (a string sets it by hand,
 * `null` switches back to automatic). `slug` is a system key, so no field can be named that.
 */
function liftSlug(body: { data: RuntimeInput; file?: UploadFile }): { data: RuntimeInput; file?: UploadFile; slug?: string | null } {
  if (!Object.hasOwn(body.data, "slug")) return body;
  const { slug, ...data } = body.data as Record<string, unknown>;
  if (slug !== null && typeof slug !== "string") throw new XenonError("BAD_REQUEST", "slug must be a string or null.");
  return { ...body, data: data as RuntimeInput, slug };
}

async function parseBody(request: Request, maxFileSize?: number): Promise<{ data: RuntimeInput; file?: UploadFile }> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType === "application/json") {
    let input: unknown;
    try { input = await request.json(); } catch { throw new XenonError("BAD_REQUEST", "Invalid JSON body."); }
    return { data: objectData(input) };
  }
  if (contentType === "multipart/form-data") {
    const form = await readForm(request, maxFileSize);
    const raw = form.get("data");
    if (raw !== null && typeof raw !== "string") throw new XenonError("BAD_REQUEST", "Multipart data must be a JSON string.");
    let input: unknown = {};
    if (raw !== null) {
      try { input = JSON.parse(raw); } catch { throw new XenonError("BAD_REQUEST", "Multipart data contains invalid JSON."); }
    }
    const data = objectData(input);
    const file = form.get("file");
    if (file === null) return { data };
    if (typeof file === "string") throw new XenonError("BAD_REQUEST", "Multipart file must be a File.");
    if (maxFileSize !== undefined && file.size > maxFileSize) {
      throw new XenonError("PAYLOAD_TOO_LARGE", `File exceeds the maximum size of ${maxFileSize} bytes.`);
    }
    return { data, file: { data: file, name: file.name, type: file.type || "application/octet-stream" } };
  }
  throw new XenonError("UNSUPPORTED_MEDIA_TYPE", "Use application/json or multipart/form-data.");
}

function errorResponse(error: unknown): Response {
  if (isXenonError(error)) {
    const errors = error.issues?.length ? error.issues.map(({ message, path }) => ({ message, path })) : [{ message: error.message }];
    return Response.json({ errors }, { status: error.status });
  }
  return Response.json({ errors: [{ message: "Internal server error." }] }, { status: 500 });
}

function fileHeaders(contentType: string, size: number, restricted: boolean, etag: string): Headers {
  const headers = new Headers({
    "content-type": contentType,
    "content-length": String(size),
    etag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "cache-control": restricted ? PRIVATE_NO_STORE : "public, max-age=31536000, immutable",
  });
  if (restricted) headers.set("vary", "Authorization, Cookie");
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (mime === "image/svg+xml" || !(/^(image|video|audio)\//.test(mime) || mime === "application/pdf")) {
    headers.set("content-disposition", "attachment");
  }
  return headers;
}

/**
 * High #5 CSRF guardrail: cookie-authenticated writes (and HTTP admin actions) require an
 * `Origin` header matching the request URL, configured public base URL, or `trustedOrigins`.
 */
export function requireTrustedOrigin(request: Request, config: XenonConfig): void {
  const origin = request.headers.get("origin");
  const publicURL = config.auth?.baseURL ?? process.env.XENON_URL ?? process.env.BETTER_AUTH_URL;
  for (const trusted of [request.url, publicURL, ...(config.auth?.trustedOrigins ?? [])]) {
    if (!trusted) continue;
    try {
      const url = new URL(trusted);
      if ((url.protocol === "https:" || url.protocol === "http:") && origin === url.origin) return;
    } catch { /* An invalid configured URL cannot establish trust. */ }
  }
  throw new XenonError("FORBIDDEN", "Cookie-authenticated writes require a trusted Origin header.");
}

/**
 * `If-Match: "<updatedAt ISO>"` on PATCH = optimistic concurrency (409 CONFLICT when the document has
 * been saved since). Weak validators and `*` are ignored.
 */
function parseIfMatch(request: Request): string | undefined {
  const value = request.headers.get("if-match")?.trim();
  if (!value || value === "*" || value.startsWith("W/")) return undefined;
  return value.replace(/^"|"$/g, "");
}

const PRESENCE_HEADERS = { "cache-control": "no-store" };
const shortString = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;

/**
 * Admin presence heartbeat. Authenticated by the signed presence token in the body (no session or
 * database lookup), so the token can't be used cross-site the way a cookie could.
 */
async function handlePresence(request: Request, config: XenonConfig): Promise<Response> {
  let input: Record<string, unknown>;
  try {
    // sendBeacon posts text/plain; parse the body as JSON whatever the content type says.
    const raw = await request.text();
    if (raw.length > 4096) throw new Error("too large");
    input = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new XenonError("BAD_REQUEST", "Invalid presence payload.");
  }
  const user = await verifyPresenceToken(resolveSecret(config), input.token);
  if (!user) return Response.json({ errors: [{ message: "Presence token expired." }] }, { status: 401, headers: PRESENCE_HEADERS });
  const tab = shortString(input.tab, 64);
  if (!tab) throw new XenonError("BAD_REQUEST", "Invalid presence payload.");
  const store = config.presence || defaultPresenceStore();
  if (input.leave === true) {
    await store.leave(user.id, tab);
    return new Response(null, { status: 204, headers: PRESENCE_HEADERS });
  }
  const loc = input.location as Record<string, unknown> | null | undefined;
  const collection = loc && typeof loc === "object" ? shortString(loc.collection, 64) : undefined;
  const locId = loc && typeof loc === "object" ? shortString(loc.id, 128) : undefined;
  const validCollection = collection && config.collections.some((c) => c.slug === collection);
  const validGlobal = collection === GLOBALS_COLLECTION && locId && (config.globals ?? []).some((g) => g.slug === locId);
  const location = validCollection || validGlobal
    ? { collection: collection!, id: locId, title: typeof (loc as Record<string, unknown>).title === "string" ? ((loc as Record<string, unknown>).title as string).slice(0, 160) : undefined }
    : null;
  const intent = input.intent === "edit" || input.intent === "takeover" ? input.intent : "view";
  const snapshot = await store.beat({ tab, user, location, intent, version: shortString(input.version, 40) });
  return Response.json(snapshot, { headers: PRESENCE_HEADERS });
}

async function handleAdminActionHttp(
  request: Request,
  config: XenonConfig,
  xenon: XenonInstance,
): Promise<Response> {
  if (request.method !== "POST") throw new XenonError("NOT_FOUND", "Route not found.");
  // Mandatory guardrail: every HTTP admin action requires a trusted Origin (High #5).
  requireTrustedOrigin(request, config);

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new XenonError("UNSUPPORTED_MEDIA_TYPE", "Admin actions require application/json.");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new XenonError("BAD_REQUEST", "Invalid JSON body.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof (raw as { type?: unknown }).type !== "string") {
    throw new XenonError("BAD_REQUEST", "Admin action payload must be a JSON object with a string type.");
  }

  const execution = await dispatchAdminActionWithHeaders(config, raw as AdminActionInput, request.headers, {
    xenon,
    captureHeaders: true,
    allowApiKey: false,
  });
  const headers = new Headers({
    "cache-control": PRIVATE_NO_STORE,
    vary: "Cookie",
  });
  if (execution.headers) {
    for (const cookie of execution.headers.getSetCookie()) headers.append("set-cookie", cookie);
  }
  const status = execution.result.ok ? 200 : actionErrorStatus(execution.result.error.code);
  return Response.json(execution.result, { status, headers });
}

async function handleAdminDataHttp(
  request: Request,
  config: XenonConfig,
  xenon: XenonInstance,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") throw new XenonError("NOT_FOUND", "Route not found.");
  const url = new URL(request.url);
  const parsed = parseAdminPath(url.searchParams.get("path"), config.admin.path);
  if (!parsed) throw new XenonError("BAD_REQUEST", "Invalid admin path.");

  // Merge inline query params from `?path=...` with explicit top-level query params (explicit wins).
  const query = new URLSearchParams(parsed.query);
  for (const [k, v] of url.searchParams.entries()) {
    if (k === "path") continue;
    query.set(k, v);
  }

  const data = await loadAdminData({
    config,
    xenon,
    segments: parsed.segments,
    query,
    headers: request.headers,
  });
  const headers = new Headers({
    "cache-control": PRIVATE_NO_STORE,
    vary: "Cookie",
  });
  const status = data.kind === "not-found" ? 404 : 200;
  if (request.method === "HEAD") {
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(null, { status, headers });
  }
  return Response.json(data, { status, headers });
}

function normalizeBasePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Extracts decoded path segments relative to `basePath`. Returns `null` when the path does not match `basePath`. */
export function extractRouteSegments(pathname: string, basePath: string): string[] | null {
  const normalizedBase = normalizeBasePath(basePath);
  let relative = pathname;
  if (normalizedBase) {
    if (relative !== normalizedBase && !relative.startsWith(`${normalizedBase}/`)) return null;
    relative = relative.slice(normalizedBase.length);
  }
  const raw = relative.split("/").filter(Boolean);
  const decoded: string[] = [];
  for (const part of raw) {
    try {
      decoded.push(decodeURIComponent(part));
    } catch {
      throw new XenonError("BAD_REQUEST", "Malformed URL encoding.");
    }
  }
  return decoded;
}

async function handlePreviewHttp(
  request: Request,
  segments: readonly string[],
  config: XenonConfig,
  xenon: XenonInstance,
): Promise<Response> {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";

  if (segments.length === 1) {
    if (request.method === "POST") {
      const user = await xenon.getUser(request.headers);
      if (!user) throw new XenonError("UNAUTHORIZED", "Authentication required.");
      if (!/^Bearer\s+.+$/i.test(request.headers.get("authorization") ?? "")) {
        requireTrustedOrigin(request, config);
      }
      const body = await readJsonObject(request, "Preview requests require application/json.");
      let kind: "collection" | "global";
      let slug: string;
      let id: string | undefined;
      let docSlug: string | null | undefined;
      if (typeof body.global === "string" && body.global.trim()) {
        kind = "global";
        slug = body.global.trim();
      } else if (typeof body.collection === "string" && body.collection.trim()) {
        kind = "collection";
        slug = body.collection.trim();
        if (body.id !== undefined) {
          if (typeof body.id !== "string" || !body.id.trim()) {
            throw new XenonError("BAD_REQUEST", "id must be a non-empty string.");
          }
          id = body.id.trim();
        }
        if (body.slug !== undefined) {
          if (body.slug !== null && typeof body.slug !== "string") {
            throw new XenonError("BAD_REQUEST", "slug must be a string or null.");
          }
          docSlug = body.slug;
        }
      } else {
        throw new XenonError("BAD_REQUEST", "Preview requests require a collection or global slug.");
      }
      const data = body.data === undefined ? undefined : (objectData(body.data) as Record<string, unknown>);
      const session = await createPreviewSession(config, xenon, {
        kind,
        slug,
        id,
        data,
        docSlug,
        user,
        requestUrl: request.url,
      });
      return Response.json(
        session ?? { token: null, url: null, enterUrl: null, targetOrigin: null },
        { status: 200, headers: { "cache-control": PRIVATE_NO_STORE, vary: "Authorization, Cookie" } },
      );
    }

    if (request.method === "GET") {
      const token = url.searchParams.get("token");
      const secret = resolveSecret(config);
      const payload = await verifyPreviewToken(secret, token);
      if (!payload) {
        throw new XenonError("UNAUTHORIZED", "Invalid or expired preview token.");
      }
      const { url: destination } = resolvePreviewUrl(payload.url, config, request.url);
      const sessionToken = await signPreviewToken(
        secret,
        {
          kind: payload.kind,
          slug: payload.slug,
          ...(payload.id !== undefined ? { id: payload.id } : {}),
          url: destination,
          userId: payload.userId,
        },
        PREVIEW_SESSION_TTL_MS,
      );
      const headers = new Headers({
        location: destination,
        "cache-control": PRIVATE_NO_STORE,
        "set-cookie": buildPreviewCookie(sessionToken, { secure }),
      });
      return new Response(null, { status: 307, headers });
    }

    throw new XenonError("NOT_FOUND", "Route not found.");
  }

  if (segments.length === 2 && segments[1] === "exit") {
    if (request.method === "GET") {
      const target = url.searchParams.get("redirect") ?? "/";
      const { url: location } = resolvePreviewUrl(target, config, request.url);
      const headers = new Headers({
        location,
        "cache-control": PRIVATE_NO_STORE,
        "set-cookie": clearPreviewCookie({ secure }),
      });
      return new Response(null, { status: 307, headers });
    }
    if (request.method === "POST") {
      if (request.headers.get("origin")) requireTrustedOrigin(request, config);
      return Response.json(
        { ok: true },
        {
          status: 200,
          headers: {
            "cache-control": PRIVATE_NO_STORE,
            "set-cookie": clearPreviewCookie({ secure }),
          },
        },
      );
    }
  }

  throw new XenonError("NOT_FOUND", "Route not found.");
}

/** Internal segment-level dispatcher shared by `createHandler` and `xenon-cms/next`'s `createApiHandler`. */
export async function handleApiSegments(
  request: Request,
  segments: readonly string[],
  config: XenonConfig,
  xenon: XenonInstance,
  options?: { cacheControl?: string },
): Promise<Response> {
  let noStoreOnError = false;
  try {
    const [slug, id, action] = segments;
    if (slug === "auth") return await xenon.handleAuthRequest(request);
    if (slug === "_presence" && segments.length === 1) {
      if (request.method !== "POST" || config.presence === false) throw new XenonError("NOT_FOUND", "Route not found.");
      return await handlePresence(request, config);
    }
    if (slug === "_preview") {
      noStoreOnError = true;
      return await handlePreviewHttp(request, segments, config, xenon);
    }
    if (slug === "_admin" && segments.length === 2) {
      noStoreOnError = true;
      if (id === "action") return await handleAdminActionHttp(request, config, xenon);
      if (id === "data") return await handleAdminDataHttp(request, config, xenon);
      throw new XenonError("NOT_FOUND", "Route not found.");
    }
    if (slug === "_files" && (request.method === "GET" || request.method === "HEAD") && segments.length > 1) {
      const key = segments.slice(1).join("/");
      let parts: string[];
      try { parts = keySegments(key); } catch { throw new XenonError("BAD_REQUEST", "Unsafe file key."); }
      const owner = xenon.getCollection(parts[0]!);
      if (!owner?.upload || parts.length < 2) throw new XenonError("NOT_FOUND", "File not found.");
      const restrictedFile = Boolean(owner.access?.read);
      if (restrictedFile) {
        noStoreOnError = true;
        const user = await xenon.getUser(request.headers);
        if (!await owner.access!.read!({ user })) {
          throw user
            ? new XenonError("FORBIDDEN", `You are not allowed to read "${owner.slug}".`)
            : new XenonError("UNAUTHORIZED", "Authentication required.");
        }
      }
      const file = await xenon.readFile(key);
      if (!file) throw new XenonError("NOT_FOUND", "File not found.");
      const bytes = file.body instanceof Uint8Array ? new Uint8Array(file.body) : null;
      const stream = bytes ? null : (file.body as ReadableStream<Uint8Array>);
      const etag = bytes ? await computeEtag(bytes) : `W/${await computeEtag(`${key}:${file.size}:${file.contentType}`)}`;
      const headers = fileHeaders(file.contentType, file.size, restrictedFile, etag);
      if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
        if (stream && typeof stream.cancel === "function") void stream.cancel().catch(() => {});
        headers.delete("content-length");
        return new Response(null, { status: 304, headers });
      }
      if (request.method === "HEAD") {
        if (stream && typeof stream.cancel === "function") void stream.cancel().catch(() => {});
        return new Response(null, { status: 200, headers });
      }
      return new Response(bytes ?? stream, { headers });
    }

    if (slug === "globals") {
      const globalSlug = id;
      const global = globalSlug ? getGlobal(config, globalSlug) : undefined;
      if (
        !global ||
        segments.length < 2 ||
        segments.length > 3 ||
        (action && (action !== "unpublish" || request.method !== "POST"))
      ) {
        throw new XenonError("NOT_FOUND", "Route not found.");
      }
      const isRead = request.method === "GET" || request.method === "HEAD";
      const user = await xenon.getUser(request.headers);
      if (!isRead && user && !/^Bearer\s+.+$/i.test(request.headers.get("authorization") ?? "")) {
        requireTrustedOrigin(request, config);
      }
      const shared = { slug: globalSlug!, user, overrideAccess: false };
      const params = new URL(request.url).searchParams;
      switch (request.method) {
        case "GET":
        case "HEAD": {
          if (action) throw new XenonError("NOT_FOUND", "Route not found.");
          const lookup = (s: string) => xenon.getCollection(s);
          const read = parseReadQuery(params, global, lookup);
          const isPublic =
            !read.draft &&
            !global.access?.read &&
            !populatesRestrictedCollection(global, read.populate, lookup);
          if (!isPublic) noStoreOnError = true;
          const doc = await xenon.getGlobal({ ...shared, ...read });
          if (!doc) throw new XenonError("NOT_FOUND", "Global not found.");
          return await jsonCachedResponse(request, doc, { isPublic, cacheControl: options?.cacheControl });
        }
        case "PATCH": {
          if (action) throw new XenonError("NOT_FOUND", "Route not found.");
          const data = await readJsonObject(request, "Global updates require application/json.");
          return Response.json(
            await xenon.updateGlobal({
              ...shared,
              data: data as never,
              draft: parseDraft(params),
              expectedUpdatedAt: parseIfMatch(request),
            }),
          );
        }
        case "POST": {
          if (action === "unpublish") return Response.json(await xenon.unpublishGlobal(shared));
          throw new XenonError("NOT_FOUND", "Route not found.");
        }
        default:
          throw new XenonError("NOT_FOUND", "Route not found.");
      }
    }

    if (slug === "_cron") {
      noStoreOnError = true;
      return await handleCronRoute(request, segments, config, xenon, () => requireTrustedOrigin(request, config));
    }
    if (slug && id && isEditorialRoute(segments) && xenon.getCollection(slug)) {
      noStoreOnError = true;
      const user = await xenon.getUser(request.headers);
      if (request.method !== "GET" && user && !/^Bearer\s+.+$/i.test(request.headers.get("authorization") ?? "")) {
        requireTrustedOrigin(request, config);
      }
      return await handleEditorialRoute(request, segments, xenon, { user, ifMatch: parseIfMatch(request) });
    }

    const collection = slug ? xenon.getCollection(slug) : undefined;
    const isPresignRoute = segments.length === 2 && (id === "_presign" || id === "_complete");
    if (
      !collection ||
      segments.length > 3 ||
      (action && (action !== "unpublish" || request.method !== "POST")) ||
      (isPresignRoute && request.method !== "POST")
    ) {
      throw new XenonError("NOT_FOUND", "Route not found.");
    }
    if (isPresignRoute) noStoreOnError = true;
    const isRead = request.method === "GET" || request.method === "HEAD";
    const user = await xenon.getUser(request.headers);
    if (!isRead && user && !/^Bearer\s+.+$/i.test(request.headers.get("authorization") ?? "")) {
      requireTrustedOrigin(request, config);
    }
    const shared = { collection: slug!, user, overrideAccess: false };
    const params = new URL(request.url).searchParams;
    const maxFileSize = typeof collection.upload === "object" ? collection.upload.maxFileSize : undefined;
    switch (request.method) {
      case "GET":
      case "HEAD": {
        const lookup = (s: string) => xenon.getCollection(s);
        if (!id) {
          const parsed = parseQuery(params, collection, lookup);
          const trash = parseTrashParam(params);
          const isPublic =
            !parsed.draft &&
            !trash &&
            !collection.access?.read &&
            !populatesRestrictedCollection(collection, parsed.populate, lookup);
          if (!isPublic) noStoreOnError = true;
          const result = await xenon.find({ ...shared, ...parsed, ...(trash ? { trash } : {}) });
          return await jsonCachedResponse(request, result, { isPublic, cacheControl: options?.cacheControl });
        }
        const read = parseReadQuery(params, collection, lookup);
        const isPublic =
          !read.draft &&
          !collection.access?.read &&
          !populatesRestrictedCollection(collection, read.populate, lookup);
        if (!isPublic) noStoreOnError = true;
        const doc = await xenon.findById({ ...shared, id, ...read });
        if (!doc) throw new XenonError("NOT_FOUND", "Document not found.");
        return await jsonCachedResponse(request, doc, { isPublic, cacheControl: options?.cacheControl });
      }
      case "POST": {
        if (id === "_presign") {
          const body = await readJsonObject(request, "Presigned upload requests require application/json.");
          if (typeof body.filename !== "string" || !body.filename.trim()) {
            throw new XenonError("BAD_REQUEST", "filename must be a non-empty string.");
          }
          if (typeof body.size !== "number" || !Number.isInteger(body.size) || body.size < 0) {
            throw new XenonError("BAD_REQUEST", "size must be a non-negative integer.");
          }
          const mimeRaw = body.mimeType ?? body.contentType ?? "";
          if (typeof mimeRaw !== "string") {
            throw new XenonError("BAD_REQUEST", "mimeType must be a string.");
          }
          if (body.id !== undefined && (typeof body.id !== "string" || !body.id.trim())) {
            throw new XenonError("BAD_REQUEST", "id must be a non-empty string.");
          }
          let expiresIn: number | undefined;
          if (body.expiresIn !== undefined) {
            if (typeof body.expiresIn !== "number" || !Number.isFinite(body.expiresIn) || body.expiresIn < 1) {
              throw new XenonError("BAD_REQUEST", "expiresIn must be a positive number of seconds.");
            }
            expiresIn = Math.min(MAX_HTTP_PRESIGN_EXPIRES_SECONDS, Math.floor(body.expiresIn));
          }
          const expectedUpdatedAt =
            parseIfMatch(request) ??
            (typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined);
          const presigned = await xenon.presignUpload({
            ...shared,
            filename: body.filename,
            mimeType: mimeRaw,
            size: body.size,
            id: body.id,
            expectedUpdatedAt,
            expiresIn,
          });
          return Response.json(presigned, { status: 200, headers: { "cache-control": PRIVATE_NO_STORE } });
        }
        if (id === "_complete") {
          const body = await readJsonObject(request, "Upload completion requires application/json.");
          if (typeof body.token !== "string" || !body.token.trim()) {
            throw new XenonError("BAD_REQUEST", "token must be a non-empty string.");
          }
          if (body.key !== undefined && typeof body.key !== "string") {
            throw new XenonError("BAD_REQUEST", "key must be a string.");
          }
          if (body.id !== undefined && (typeof body.id !== "string" || !body.id.trim())) {
            throw new XenonError("BAD_REQUEST", "id must be a non-empty string.");
          }
          const data = body.data === undefined ? ({} as RuntimeInput) : objectData(body.data);
          const expectedUpdatedAt =
            parseIfMatch(request) ??
            (typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined);
          const doc = await xenon.completeUpload({
            ...shared,
            token: body.token,
            key: body.key,
            id: body.id,
            data,
            expectedUpdatedAt,
          });
          const replaced = body.id !== undefined || doc.updatedAt !== doc.createdAt;
          return Response.json(doc, { status: replaced ? 200 : 201, headers: { "cache-control": PRIVATE_NO_STORE } });
        }
        if (id && action === "unpublish") return Response.json(await xenon.unpublish({ ...shared, id }));
        if (id) throw new XenonError("NOT_FOUND", "Route not found.");
        return Response.json(await xenon.create({ ...shared, ...liftSlug(await parseBody(request, maxFileSize)), draft: parseDraft(params) }), { status: 201 });
      }
      case "PATCH": {
        if (!id) throw new XenonError("NOT_FOUND", "Route not found.");
        return Response.json(await xenon.update({ ...shared, id, ...liftSlug(await parseBody(request, maxFileSize)), draft: parseDraft(params), expectedUpdatedAt: parseIfMatch(request) }));
      }
      case "DELETE": {
        if (!id) throw new XenonError("NOT_FOUND", "Route not found.");
        return Response.json(await (parsePermanentParam(params) ? xenon.purge({ ...shared, id }) : xenon.delete({ ...shared, id })));
      }
      default:
        throw new XenonError("NOT_FOUND", "Route not found.");
    }
  } catch (error) {
    const response = errorResponse(error);
    if (noStoreOnError) response.headers.set("cache-control", PRIVATE_NO_STORE);
    return response;
  }
}

/**
 * Framework-agnostic Web Standard HTTP handler (`(req: Request) => Promise<Response>`).
 * Routes by URL pathname relative to `options.basePath ?? config.api.path`.
 * Works natively on Hono, Bun.serve, Deno, Cloudflare Workers, Astro, TanStack Start, and Next.js.
 */
export function createHandler<Cfg extends XenonConfig>(
  config: Cfg,
  options?: CreateHandlerOptions<Cfg>,
): XenonHttpHandler {
  const xenon = (options?.xenon ?? getHttpXenon(config)) as XenonInstance;
  const basePath = options?.basePath ?? config.api.path;

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const segments = extractRouteSegments(url.pathname, basePath);
      if (segments === null) {
        return Response.json({ errors: [{ message: "Route not found." }] }, { status: 404 });
      }
      return await handleApiSegments(request, segments, config, xenon, { cacheControl: options?.cacheControl });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
