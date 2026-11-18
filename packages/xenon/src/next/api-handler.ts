import { isXenonError, XenonError } from "../core/errors";
import type { XenonConfig } from "../core/types";
import type { UploadFile, XenonInstance } from "../server/types";
import { keySegments } from "../storage/keys";
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

async function parseBody(request: Request): Promise<{ data: RuntimeInput; file?: UploadFile }> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType === "application/json") {
    let input: unknown;
    try { input = await request.json(); } catch { throw new XenonError("BAD_REQUEST", "Invalid JSON body."); }
    return { data: objectData(input) };
  }
  if (contentType === "multipart/form-data") {
    let form: FormData;
    try { form = await request.formData(); } catch { throw new XenonError("BAD_REQUEST", "Invalid multipart body."); }
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
    return { data, file: { data: new Uint8Array(await file.arrayBuffer()), name: file.name, type: file.type || "application/octet-stream" } };
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

function fileHeaders(contentType: string, size: number): Headers {
  const headers = new Headers({
    "content-type": contentType,
    "content-length": String(size),
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "cache-control": "public, max-age=31536000, immutable",
  });
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (mime === "image/svg+xml" || !(/^(image|video|audio)\//.test(mime) || mime === "application/pdf")) {
    headers.set("content-disposition", "attachment");
  }
  return headers;
}

function requireTrustedOrigin(request: Request, config: XenonConfig): void {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const incoming = new URL(origin);
      if (incoming.origin === origin && [new URL(request.url).origin, ...(config.auth?.trustedOrigins ?? [])].some((trusted) => {
        try { return new URL(trusted).origin === incoming.origin; } catch { return false; }
      })) return;
    } catch { /* Malformed, opaque, or multiple origins are not trusted. */ }
  }
  throw new XenonError("FORBIDDEN", "Cookie-authenticated writes require a trusted Origin header.");
}

/** Catch-all REST handlers. Every document operation enforces the Local API access rules. */
export function createApiHandler<Cfg extends XenonConfig>(config: Cfg, options?: { xenon?: XenonInstance<Cfg> }) {
  // Route segments are checked at runtime against getCollection before reaching the Local API.
  const xenon = (options?.xenon ?? getXenon(config)) as XenonInstance;

  async function handle(request: Request, context: RouteContext): Promise<Response> {
    try {
      const { slug: segments } = await context.params;
      const [slug, id, action] = segments ?? [];
      if (slug === "auth") return await xenon.handleAuthRequest(request);
      if (slug === "_files" && request.method === "GET" && segments.length > 1) {
        const key = segments.slice(1).join("/");
        try { keySegments(key); } catch { throw new XenonError("BAD_REQUEST", "Unsafe file key."); }
        const file = await xenon.readFile(key);
        if (!file) throw new XenonError("NOT_FOUND", "File not found.");
        const body = file.body instanceof Uint8Array ? new Uint8Array(file.body) : file.body;
        return new Response(body, { headers: fileHeaders(file.contentType, file.size) });
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
          return Response.json(await xenon.create({ ...shared, ...await parseBody(request), draft: parseDraft(params) }), { status: 201 });
        }
        case "PATCH": {
          if (!id) throw new XenonError("NOT_FOUND", "Route not found.");
          return Response.json(await xenon.update({ ...shared, id, ...await parseBody(request), draft: parseDraft(params) }));
        }
        case "DELETE": {
          if (!id) throw new XenonError("NOT_FOUND", "Route not found.");
          return Response.json(await xenon.delete({ ...shared, id }));
        }
        default: throw new XenonError("NOT_FOUND", "Route not found.");
      }
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { GET: handle, POST: handle, PATCH: handle, DELETE: handle };
}
