import { resolveSecret } from "../auth";
import { withReadDefaults } from "../core/defaults";
import { XenonError } from "../core/errors";
import { getGlobal } from "../core/global";
import type { AnyCollection, XenonConfig, XenonUser } from "../core/types";
import type { XenonInstance } from "./types";

/** HttpOnly cookie set when entering Live Preview via `GET /{api}/_preview?token=...`. */
export const PREVIEW_COOKIE_NAME = "xenon-preview";
/** Short-lived signed entry token lifetime (15 minutes). */
export const PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;
/** Preview session cookie lifetime (2 hours). */
export const PREVIEW_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export interface PreviewTokenPayload {
  kind: "collection" | "global";
  slug: string;
  /** Document id (collections only). */
  id?: string;
  /** Validated preview destination URL (relative path or trusted-origin URL). */
  url: string;
  /** Signed-in user who requested the preview. */
  userId: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

export interface PreviewSessionInfo {
  /** Signed HMAC entry token. */
  token: string;
  /** Resolved preview URL returned by `admin.previewUrl(doc)`. */
  url: string;
  /** Preview entry endpoint URL (`{api.path}/_preview?token=...`) that sets the preview cookie and redirects to `url`. */
  enterUrl: string;
  /** Origin of `url` when absolute (or of the request URL when relative), used for `postMessage` targeting. */
  targetOrigin: string | null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    // Domain-separated from BetterAuth, presence, and presigned upload tokens.
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(`xenon-preview:v1:${secret}`),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    keyCache.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Mints an HMAC-SHA256 signed preview token. */
export async function signPreviewToken(
  secret: string,
  payload: Omit<PreviewTokenPayload, "exp"> & { exp?: number },
  ttlMs = PREVIEW_TOKEN_TTL_MS,
  now = Date.now(),
): Promise<string> {
  const full: PreviewTokenPayload = {
    kind: payload.kind,
    slug: payload.slug,
    ...(payload.id !== undefined ? { id: payload.id } : {}),
    url: payload.url,
    userId: payload.userId,
    exp: payload.exp ?? now + ttlMs,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(full)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** Verifies an HMAC-SHA256 preview token (constant-time signature + expiry check). */
export async function verifyPreviewToken(
  secret: string,
  token: unknown,
  now = Date.now(),
): Promise<PreviewTokenPayload | null> {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(signature), encoder.encode(body));
    if (!valid) return null;
    const raw = JSON.parse(decoder.decode(fromBase64Url(body))) as Partial<PreviewTokenPayload>;
    if (
      (raw.kind !== "collection" && raw.kind !== "global") ||
      typeof raw.slug !== "string" ||
      !raw.slug ||
      typeof raw.url !== "string" ||
      !raw.url ||
      typeof raw.userId !== "string" ||
      typeof raw.exp !== "number" ||
      raw.exp <= now
    ) {
      return null;
    }
    if (raw.id !== undefined && typeof raw.id !== "string") return null;
    return {
      kind: raw.kind,
      slug: raw.slug,
      ...(raw.id !== undefined ? { id: raw.id } : {}),
      url: raw.url,
      userId: raw.userId,
      exp: raw.exp,
    };
  } catch {
    return null;
  }
}

function trustedOriginsFor(config: XenonConfig, requestUrl?: string): Set<string> {
  const origins = new Set<string>();
  const publicURL = config.auth?.baseURL ?? process.env.XENON_URL ?? process.env.BETTER_AUTH_URL;
  for (const candidate of [requestUrl, publicURL, ...(config.auth?.trustedOrigins ?? [])]) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") origins.add(parsed.origin);
    } catch {
      // Ignore malformed configured URLs.
    }
  }
  return origins;
}

/**
 * Validates a preview URL or redirect target against open-redirect rules:
 * - Relative paths starting with `/` (rejecting protocol-relative `//` and `\`);
 * - Or absolute `http:`/`https:` URLs whose origin is trusted (request origin, `auth.baseURL`, `trustedOrigins`).
 */
export function resolvePreviewUrl(
  rawUrl: unknown,
  config: XenonConfig,
  requestUrl?: string,
): { url: string; targetOrigin: string | null } {
  if (typeof rawUrl !== "string") {
    throw new XenonError("BAD_REQUEST", "Preview URL must be a string.");
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048 || /[\r\n\0]/.test(trimmed)) {
    throw new XenonError("BAD_REQUEST", "Invalid preview URL.");
  }
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//") || trimmed.includes("\\")) {
      throw new XenonError("BAD_REQUEST", "Preview URL must not be protocol-relative.");
    }
    let origin: string | null = null;
    if (requestUrl) {
      try {
        origin = new URL(requestUrl).origin;
      } catch {
        origin = null;
      }
    }
    return { url: trimmed, targetOrigin: origin };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new XenonError("BAD_REQUEST", "Preview URL must be a relative path or a valid http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new XenonError("BAD_REQUEST", "Preview URL must use http or https.");
  }
  const trusted = trustedOriginsFor(config, requestUrl);
  if (!trusted.has(parsed.origin)) {
    throw new XenonError(
      "BAD_REQUEST",
      `Preview URL origin "${parsed.origin}" is not trusted. Add it to auth.trustedOrigins or use a relative path.`,
    );
  }
  return { url: parsed.toString(), targetOrigin: parsed.origin };
}

/** Builds a `Set-Cookie` header enabling the HttpOnly `xenon-preview` cookie. */
export function buildPreviewCookie(
  token: string,
  options: { secure?: boolean; maxAgeSeconds?: number } = {},
): string {
  const maxAge = Math.max(0, Math.floor(options.maxAgeSeconds ?? PREVIEW_SESSION_TTL_MS / 1000));
  const parts = [
    `${PREVIEW_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Builds a `Set-Cookie` header clearing the `xenon-preview` cookie. */
export function clearPreviewCookie(options: { secure?: boolean } = {}): string {
  const parts = [
    `${PREVIEW_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Extracts the raw `xenon-preview` cookie value from a `Headers` object or raw `Cookie` string. */
export function readPreviewCookie(input: Headers | string | null | undefined): string | null {
  const header = typeof input === "string" ? input : input instanceof Headers ? input.get("cookie") : null;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== PREVIEW_COOKIE_NAME) continue;
    const raw = part.slice(eq + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * Verifies whether an incoming request (or its `Headers`) carries a valid, unexpired Xenon preview
 * session cookie (or `?xenon_preview=<token>` query param on a `Request`).
 * Works identically in Next.js, Astro, Hono, TanStack Start, Bun, and Cloudflare Workers.
 */
export async function verifyPreviewRequest(
  config: XenonConfig,
  requestOrHeaders: Request | Headers | null | undefined,
): Promise<PreviewTokenPayload | null> {
  if (!requestOrHeaders) return null;
  const headers = requestOrHeaders instanceof Request ? requestOrHeaders.headers : requestOrHeaders;
  let token = readPreviewCookie(headers);
  if (!token && requestOrHeaders instanceof Request) {
    try {
      token = new URL(requestOrHeaders.url).searchParams.get("xenon_preview");
    } catch {
      token = null;
    }
  }
  if (!token) return null;
  try {
    return await verifyPreviewToken(resolveSecret(config), token);
  } catch {
    return null;
  }
}

/** Convenience boolean check: `true` when the request carries a valid signed Xenon preview token/cookie. */
export async function isPreviewRequest(
  config: XenonConfig,
  requestOrHeaders: Request | Headers | null | undefined,
): Promise<boolean> {
  return (await verifyPreviewRequest(config, requestOrHeaders)) !== null;
}

export interface CreatePreviewSessionArgs {
  kind: "collection" | "global";
  slug: string;
  id?: string;
  /** Optional unsaved field values used to compute `previewUrl(doc)` before a save. */
  data?: Record<string, unknown>;
  /** Optional unsaved slug override for collection preview URL calculation. */
  docSlug?: string | null;
  user: XenonUser;
  requestUrl?: string;
}

/**
 * Enforces read access, evaluates `admin.previewUrl(doc)`, validates the resulting URL against
 * trusted origins, and mints a short-lived signed preview entry token.
 * Returns `null` when `admin.previewUrl(doc)` returns `null`/`undefined`.
 */
export async function createPreviewSession(
  config: XenonConfig,
  xenon: XenonInstance,
  args: CreatePreviewSessionArgs,
): Promise<PreviewSessionInfo | null> {
  let doc: Record<string, unknown>;
  let previewUrlFn: ((doc: Record<string, unknown>) => string | null | undefined) | undefined;

  if (args.kind === "collection") {
    const collection = xenon.getCollection(args.slug) as AnyCollection | undefined;
    if (!collection) throw new XenonError("NOT_FOUND", `Unknown collection "${args.slug}".`);
    previewUrlFn = collection.admin?.previewUrl;
    if (!previewUrlFn) {
      throw new XenonError("BAD_REQUEST", `Collection "${collection.slug}" does not define admin.previewUrl.`);
    }
    if (args.id) {
      const existing = await xenon.findById({
        collection: collection.slug,
        id: args.id,
        draft: true,
        user: args.user,
        overrideAccess: false,
      });
      if (!existing) throw new XenonError("NOT_FOUND", `Document "${args.id}" not found in "${collection.slug}".`);
      doc = { ...(existing as Record<string, unknown>) };
      if (args.data) {
        const merged = withReadDefaults(collection.fields, { ...doc, ...args.data });
        Object.assign(doc, merged);
      }
      if (args.docSlug !== undefined) doc.slug = args.docSlug;
    } else {
      // Verify read access even for an unsaved new document preview.
      await xenon.find({
        collection: collection.slug,
        draft: true,
        limit: 1,
        user: args.user,
        overrideAccess: false,
      });
      const fields = withReadDefaults(collection.fields, args.data ?? {});
      doc = {
        id: "",
        slug: args.docSlug ?? null,
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...fields,
      };
    }
  } else {
    const global = getGlobal(config, args.slug);
    if (!global) throw new XenonError("NOT_FOUND", `Unknown global "${args.slug}".`);
    previewUrlFn = global.admin?.previewUrl;
    if (!previewUrlFn) {
      throw new XenonError("BAD_REQUEST", `Global "${global.slug}" does not define admin.previewUrl.`);
    }
    const existing = await xenon.getGlobal({
      slug: global.slug,
      draft: true,
      user: args.user,
      overrideAccess: false,
    });
    const baseFields = withReadDefaults(global.fields, {
      ...((existing as Record<string, unknown> | null) ?? {}),
      ...(args.data ?? {}),
    });
    doc = existing
      ? { ...(existing as Record<string, unknown>), ...baseFields }
      : {
          id: "",
          slug: global.slug,
          status: "draft",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...baseFields,
        };
  }

  const rawUrl = previewUrlFn(doc);
  if (rawUrl === null || rawUrl === undefined || rawUrl === "") return null;

  const { url, targetOrigin } = resolvePreviewUrl(rawUrl, config, args.requestUrl);
  const token = await signPreviewToken(resolveSecret(config), {
    kind: args.kind,
    slug: args.slug,
    ...(args.id ? { id: args.id } : {}),
    url,
    userId: args.user.id,
  });
  const base = config.api.path.replace(/\/+$/, "");
  return {
    token,
    url,
    enterUrl: `${base}/_preview?token=${encodeURIComponent(token)}`,
    targetOrigin,
  };
}
