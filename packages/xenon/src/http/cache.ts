/**
 * Web-standard HTTP caching helpers: strong ETag generation, RFC 9110 `If-None-Match`
 * weak comparison, and access-aware `Cache-Control` / `Vary` headers.
 */

const encoder = new TextEncoder();

export const DEFAULT_PUBLIC_CACHE_CONTROL = "public, max-age=0, must-revalidate";
export const PRIVATE_NO_STORE = "private, no-store";

/** Computes a quoted strong ETag from UTF-8 text or raw bytes using Web Crypto SHA-256. */
export async function computeEtag(body: string | Uint8Array): Promise<string> {
  const bytes = typeof body === "string" ? encoder.encode(body) : body;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  const view = new Uint8Array(digest, 0, 16);
  let hex = "";
  for (let i = 0; i < view.length; i++) hex += view[i]!.toString(16).padStart(2, "0");
  return `"${hex}"`;
}

function stripWeak(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith("W/") ? trimmed.slice(2).trim() : trimmed;
}

/** Splits an `If-None-Match` header value on commas outside quoted strings. */
function splitEntityTags(header: string): string[] {
  const tags: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (ch === '"' && header[i - 1] !== "\\") inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      tags.push(header.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = header.slice(start).trim();
  if (tail) tags.push(tail);
  return tags;
}

/**
 * RFC 9110 §13.1.2 weak comparison for `If-None-Match`.
 * Matches `*` or any listed entity-tag whose opaque-tag equals `etag`.
 */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  const trimmed = header.trim();
  if (!trimmed) return false;
  if (trimmed === "*") return true;
  const target = stripWeak(etag);
  for (const candidate of splitEntityTags(trimmed)) {
    if (candidate === "*" || stripWeak(candidate) === target) return true;
  }
  return false;
}

export interface JsonCacheOptions {
  /** `true` only for anonymous-safe, non-draft reads without a custom `access.read` rule. */
  isPublic: boolean;
  /** Override `Cache-Control` for public reads. Defaults to `public, max-age=0, must-revalidate`. */
  cacheControl?: string;
}

/**
 * Serializes `payload` to JSON with `ETag`, `Cache-Control`, and `Vary` headers,
 * returning `304 Not Modified` when `If-None-Match` matches.
 */
export async function jsonCachedResponse(
  request: Request,
  payload: unknown,
  options: JsonCacheOptions,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const etag = await computeEtag(body);
  const headers = new Headers({
    etag,
    "cache-control": options.isPublic ? (options.cacheControl ?? DEFAULT_PUBLIC_CACHE_CONTROL) : PRIVATE_NO_STORE,
  });
  if (!options.isPublic) headers.set("vary", "Authorization, Cookie");

  if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}
