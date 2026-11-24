import { isXenonError, XenonError } from "../core/errors";
import type { XenonConfig } from "../core/types";
import type { UploadFile, XenonInstance } from "../server/types";
import { keySegments } from "../storage/keys";
import { resolveSecret } from "../auth";
import { defaultPresenceStore, verifyPresenceToken } from "../server/presence";
import { parseDraft, parseQuery } from "./query";
import { getXenon } from "./xenon";

export interface RouteContext {
  params: Promise<{ slug: string[] }>;
}

type RuntimeInput = Parameters<XenonInstance["create"]>[0]["data"];

function objectData(input: unknown): RuntimeInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new XenonError("BAD_REQUEST", "Document data must be a JSON object.");
  }
  // This is the HTTP trust boundary; the Local API validates every field against its collection.
  return input as RuntimeInput;
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

function fileHeaders(contentType: string, size: number, restricted: boolean): Headers {
  const headers = new Headers({
    "content-type": contentType,
    "content-length": String(size),
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "cache-control": restricted ? "private, no-store" : "public, max-age=31536000, immutable",
  });
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (mime === "image/svg+xml" || !(/^(image|video|audio)\//.test(mime) || mime === "application/pdf")) {
    headers.set("content-disposition", "attachment");
  }
  return headers;
}

function requireTrustedOrigin(request: Request, config: XenonConfig): void {
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
  const location = collection && config.collections.some((c) => c.slug === collection)
    ? { collection, id: shortString((loc as Record<string, unknown>).id, 128), title: typeof (loc as Record<string, unknown>).title === "string" ? ((loc as Record<string, unknown>).title as string).slice(0, 160) : undefined }
    : null;
  const intent = input.intent === "edit" || input.intent === "takeover" ? input.intent : "view";
  const snapshot = await store.beat({ tab, user, location, intent, version: shortString(input.version, 40) });
  return Response.json(snapshot, { headers: PRESENCE_HEADERS });
}

/** Catch-all REST handlers. Every document operation enforces the Local API access rules. */
export function createApiHandler<Cfg extends XenonConfig>(config: Cfg, options?: { xenon?: XenonInstance<Cfg> }) {
  // Route segments are checked at runtime against getCollection before reaching the Local API.
  const xenon = (options?.xenon ?? getXenon(config)) as XenonInstance;

  async function handle(request: Request, context: RouteContext): Promise<Response> {
    let restrictedFile = false;
    try {
      const { slug: segments } = await context.params;
      const [slug, id, action] = segments ?? [];
      if (slug === "auth") return await xenon.handleAuthRequest(request);
      if (slug === "_presence" && segments.length === 1) {
        if (request.method !== "POST" || config.presence === false) throw new XenonError("NOT_FOUND", "Route not found.");
        return await handlePresence(request, config);
      }
      if (slug === "_files" && request.method === "GET" && segments.length > 1) {
        const key = segments.slice(1).join("/");
        let parts: string[];
        try { parts = keySegments(key); } catch { throw new XenonError("BAD_REQUEST", "Unsafe file key."); }
        const owner = xenon.getCollection(parts[0]!);
        if (!owner?.upload || parts.length < 2) throw new XenonError("NOT_FOUND", "File not found.");
        if (owner.access?.read) {
          restrictedFile = true;
          const user = await xenon.getUser(request.headers);
          if (!await owner.access.read({ user })) {
            throw user
              ? new XenonError("FORBIDDEN", `You are not allowed to read "${owner.slug}".`)
              : new XenonError("UNAUTHORIZED", "Authentication required.");
          }
        }
        const file = await xenon.readFile(key);
        if (!file) throw new XenonError("NOT_FOUND", "File not found.");
        const body = file.body instanceof Uint8Array ? new Uint8Array(file.body) : file.body;
        return new Response(body, { headers: fileHeaders(file.contentType, file.size, restrictedFile) });
      }
      const collection = slug ? xenon.getCollection(slug) : undefined;
      if (!collection || segments.length > 3 || (action && (action !== "unpublish" || request.method !== "POST"))) {
        throw new XenonError("NOT_FOUND", "Route not found.");
      }
      const user = await xenon.getUser(request.headers);
      if (request.method !== "GET" && user && !/^Bearer\s+.+$/i.test(request.headers.get("authorization") ?? "")) {
        requireTrustedOrigin(request, config);
      }
      const shared = { collection: slug!, user, overrideAccess: false };
      const params = new URL(request.url).searchParams;
      const maxFileSize = typeof collection.upload === "object" ? collection.upload.maxFileSize : undefined;
      switch (request.method) {
        case "GET": {
          if (!id) return Response.json(await xenon.find({ ...shared, ...parseQuery(params, collection) }));
          const doc = await xenon.findById({ ...shared, id, draft: parseDraft(params) });
          if (!doc) throw new XenonError("NOT_FOUND", "Document not found.");
          return Response.json(doc);
        }
        case "POST": {
          if (id && action === "unpublish") return Response.json(await xenon.unpublish({ ...shared, id }));
          if (id) throw new XenonError("NOT_FOUND", "Route not found.");
          return Response.json(await xenon.create({ ...shared, ...await parseBody(request, maxFileSize), draft: parseDraft(params) }), { status: 201 });
        }
        case "PATCH": {
          if (!id) throw new XenonError("NOT_FOUND", "Route not found.");
          return Response.json(await xenon.update({ ...shared, id, ...await parseBody(request, maxFileSize), draft: parseDraft(params), expectedUpdatedAt: parseIfMatch(request) }));
        }
        case "DELETE": {
          if (!id) throw new XenonError("NOT_FOUND", "Route not found.");
          return Response.json(await xenon.delete({ ...shared, id }));
        }
        default: throw new XenonError("NOT_FOUND", "Route not found.");
      }
    } catch (error) {
      const response = errorResponse(error);
      if (restrictedFile) response.headers.set("cache-control", "private, no-store");
      return response;
    }
  }

  return { GET: handle, POST: handle, PATCH: handle, DELETE: handle };
}
