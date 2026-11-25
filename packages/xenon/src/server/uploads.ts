import { imageSize } from "image-size";
import type { StorageAdapter } from "../adapters/types";
import { XenonError } from "../core/errors";
import type { AnyCollection, UploadData, UploadOptions } from "../core/types";
import { keySegments } from "../storage/keys";
import type { UploadFile } from "./types";

/** Maximum prefix bytes fetched by Range GET during presigned upload verification (magic bytes + image-size). */
export const PRESIGN_SNIFF_BYTES = 64 * 1024;
/** Default presigned upload URL and token lifetime in seconds (15 minutes). */
export const PRESIGN_DEFAULT_EXPIRES_IN = 900;

export interface PreparedUpload {
  key: string;
  body: Uint8Array;
  meta: Omit<UploadData, "url">;
}

export interface PresignedPlan {
  key: string;
  filename: string;
  mimeType: string;
}

export interface VerifiedPresignedUpload {
  key: string;
  url: string;
  meta: Omit<UploadData, "url">;
}

export interface PresignTokenPayload {
  collection: string;
  key: string;
  filename: string;
  mimeType: string;
  size: number;
  userId: string | null;
  id?: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
  return `${stem || "file"}${ext ? `.${ext}` : ""}`;
}

export function normalizeMimeType(raw: string | null | undefined): string {
  const base = (raw ?? "").split(";")[0]?.trim().toLowerCase();
  return base || "application/octet-stream";
}

function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function mimeAllowed(type: string, allowed: readonly string[]): boolean {
  return allowed.some((pattern) =>
    pattern.endsWith("/*") ? type.startsWith(pattern.slice(0, -1)) : pattern === type,
  );
}

/** Types a browser may execute or render as a document. Never accepted as uploads, even when allowed by `mimeTypes`. */
const ACTIVE_CONTENT = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
]);

const ACTIVE_EXTENSIONS = new Set(["html", "htm", "xhtml", "svg", "svgz", "xml", "js", "mjs", "cjs"]);

/** True when the start of the file (after an optional BOM and whitespace) looks like markup that a browser would render. */
function hasActiveMarkup(body: Uint8Array): boolean {
  let start = body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf ? 3 : 0;
  while (start < body.length && (body[start] === 0x20 || body[start] === 0x09 || body[start] === 0x0a || body[start] === 0x0d)) start++;
  const head = String.fromCharCode(...body.subarray(start, Math.min(body.length, start + 32))).toLowerCase();
  return ["<!doctype", "<html", "<svg", "<?xml", "<script", "<head", "<body"].some((tag) => head.startsWith(tag));
}

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  pdf: "application/pdf",
};

const SNIFFABLE = new Set(Object.values(EXTENSION_TYPES));

/** Identify the file from its leading bytes. Returns null for anything not recognized. */
export function sniffMimeType(body: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...body.subarray(from, Math.min(to, body.length)));
  if (body.length >= 8 && body[0] === 0x89 && ascii(1, 4) === "PNG" && body[4] === 0x0d && body[5] === 0x0a) return "image/png";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (body.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (body.length >= 12 && ascii(4, 8) === "ftyp" && (ascii(8, 12) === "avif" || ascii(8, 12) === "avis")) return "image/avif";
  if (body.length >= 5 && ascii(0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/**
 * Decide the stored MIME type. The browser-declared type is untrusted: a recognized file's bytes win, a declared
 * type that contradicts them is rejected, and active-content types are refused outright.
 */
export function resolveUploadType(body: Uint8Array, name: string, declared: string, allowed?: readonly string[]): string {
  const reject = (msg: string): never => {
    throw new XenonError("UNSUPPORTED_MEDIA_TYPE", msg);
  };
  const declaredBase = normalizeMimeType(declared);
  if (ACTIVE_CONTENT.has(declaredBase)) reject(`File type "${declaredBase}" is not allowed.`);

  const ext = fileExtension(name);
  // Active-content extensions are refused whatever the bytes or the declared type say: a file served from our origin
  // under one of these names can run script.
  if (ACTIVE_EXTENSIONS.has(ext)) reject(`File extension ".${ext}" is not allowed.`);
  // Markup in the leading bytes is refused too, so a text file can't be stored as an innocent image type.
  if (hasActiveMarkup(body)) reject("File contents look like HTML, SVG or XML, which are not allowed.");

  const sniffed = sniffMimeType(body);
  if (sniffed) {
    if (declaredBase !== "application/octet-stream" && declaredBase !== sniffed) {
      reject(`File contents are ${sniffed}, not the declared type "${declaredBase}".`);
    }
    // A recognized file must carry an extension of its own type: a PNG named evil.html, or photo.bin, is refused.
    if (ext && EXTENSION_TYPES[ext] !== sniffed) {
      reject(`File extension ".${ext}" does not match its contents (${sniffed}).`);
    }
  } else if (declaredBase === "application/octet-stream") {
    // Unrecognized bytes with no declared type: allowed only when the collection accepts any type.
    if (allowed?.length) reject(`File type "application/octet-stream" is not allowed.`);
    return "application/octet-stream";
  }

  // A type we can identify must be backed by matching bytes; a declared image/PDF with unrecognized bytes is refused.
  if (!sniffed && SNIFFABLE.has(declaredBase)) reject(`File contents do not match the declared type "${declaredBase}".`);

  const effective = sniffed ?? declaredBase;
  if (ACTIVE_CONTENT.has(effective)) reject(`File type "${effective}" is not allowed.`);
  if (allowed?.length && !mimeAllowed(effective, allowed)) reject(`File type "${effective}" is not allowed.`);
  return effective;
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export function buildStorageKey(collectionSlug: string, filename: string, now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${collectionSlug}/${now.getUTCFullYear()}/${month}/${randomId()}-${filename}`;
}

function extractImageDimensions(body: Uint8Array, mimeType: string): { width: number | null; height: number | null } {
  if (!mimeType.startsWith("image/") || body.byteLength === 0) return { width: null, height: null };
  try {
    const dims = imageSize(body);
    return { width: dims.width ?? null, height: dims.height ?? null };
  } catch {
    // Not a parseable image (or dimensions beyond the Range-GET window) — leave empty.
    return { width: null, height: null };
  }
}

export async function prepareUpload(collection: AnyCollection, file: UploadFile): Promise<PreparedUpload> {
  const options: UploadOptions = typeof collection.upload === "object" ? collection.upload : {};
  const body = file.data instanceof Uint8Array ? file.data : new Uint8Array(await file.data.arrayBuffer());
  const declared = normalizeMimeType(file.type);
  const mimeType = resolveUploadType(body, file.name, declared, options.mimeTypes);
  if (options.maxFileSize !== undefined && body.byteLength > options.maxFileSize) {
    throw new XenonError("PAYLOAD_TOO_LARGE", `File exceeds the maximum size of ${options.maxFileSize} bytes.`);
  }

  const { width, height } = extractImageDimensions(body, mimeType);
  const filename = safeFileName(file.name);
  return {
    key: buildStorageKey(collection.slug, filename),
    body,
    meta: { filename, mimeType, filesize: body.byteLength, width, height },
  };
}

/**
 * Pre-upload policy check for `POST /{api}/{collection}/_presign`.
 * Rejects disallowed MIME types, active extensions, mismatched extensions, and oversized files before
 * minting a presigned URL. The actual bytes are re-verified after upload by `verifyPresignedObject`.
 */
export function validatePresignRequest(
  collection: AnyCollection,
  input: { filename: string; mimeType: string; size: number },
): PresignedPlan {
  if (typeof input.filename !== "string" || !input.filename.trim()) {
    throw new XenonError("BAD_REQUEST", "filename must be a non-empty string.");
  }
  if (typeof input.size !== "number" || !Number.isInteger(input.size) || input.size < 0) {
    throw new XenonError("BAD_REQUEST", "size must be a non-negative integer.");
  }
  const options: UploadOptions = typeof collection.upload === "object" ? collection.upload : {};
  if (options.maxFileSize !== undefined && input.size > options.maxFileSize) {
    throw new XenonError("PAYLOAD_TOO_LARGE", `File exceeds the maximum size of ${options.maxFileSize} bytes.`);
  }

  const rawExt = fileExtension(input.filename);
  const filename = safeFileName(input.filename);
  const safeExt = fileExtension(filename);
  if (ACTIVE_EXTENSIONS.has(rawExt) || ACTIVE_EXTENSIONS.has(safeExt)) {
    throw new XenonError("UNSUPPORTED_MEDIA_TYPE", `File extension ".${rawExt || safeExt}" is not allowed.`);
  }
  const declaredRaw = normalizeMimeType(input.mimeType);
  if (ACTIVE_CONTENT.has(declaredRaw)) {
    throw new XenonError("UNSUPPORTED_MEDIA_TYPE", `File type "${declaredRaw}" is not allowed.`);
  }
  // Browsers sometimes leave `file.type` empty for formats like AVIF; infer known safe types from the extension
  // (the actual magic bytes are still verified by `verifyPresignedObject` during `_complete`).
  const declared =
    declaredRaw === "application/octet-stream" && safeExt && EXTENSION_TYPES[safeExt]
      ? EXTENSION_TYPES[safeExt]!
      : declaredRaw;
  if (SNIFFABLE.has(declared) && safeExt && EXTENSION_TYPES[safeExt] !== declared) {
    throw new XenonError("UNSUPPORTED_MEDIA_TYPE", `File extension ".${safeExt}" does not match the declared type "${declared}".`);
  }
  if (options.mimeTypes?.length && !mimeAllowed(declared, options.mimeTypes)) {
    throw new XenonError("UNSUPPORTED_MEDIA_TYPE", `File type "${declared}" is not allowed.`);
  }

  return {
    key: buildStorageKey(collection.slug, filename),
    filename,
    mimeType: declared,
  };
}

/**
 * Critical #2 security & dimension guardrail for `POST /{api}/{collection}/_complete`.
 * Verifies key prefix, runs `HEAD` (`Content-Length <= maxFileSize`, non-active `Content-Type`),
 * fetches a single bounded Range `GET` (<= 64 KB) to sniff magic bytes, block active markup, and
 * extract `image-size` width/height. Immediately deletes the object from storage on any mismatch.
 */
export async function verifyPresignedObject(
  collection: AnyCollection,
  storage: StorageAdapter,
  key: string,
  filename: string,
  declaredMimeType: string,
): Promise<VerifiedPresignedUpload> {
  let parts: string[];
  try {
    parts = keySegments(key);
  } catch {
    throw new XenonError("BAD_REQUEST", "Unsafe upload key.");
  }
  if (parts.length < 2 || parts[0] !== collection.slug) {
    throw new XenonError("BAD_REQUEST", "Upload key does not belong to this collection.");
  }
  if (!storage.head || !storage.readRange) {
    throw new XenonError("NOT_IMPLEMENTED", "Configured storage adapter does not support presigned upload verification.");
  }

  const info = await storage.head(key);
  if (!info) {
    throw new XenonError("BAD_REQUEST", "Uploaded file was not found in storage.");
  }

  const options: UploadOptions = typeof collection.upload === "object" ? collection.upload : {};
  try {
    if (options.maxFileSize !== undefined && info.size > options.maxFileSize) {
      throw new XenonError("PAYLOAD_TOO_LARGE", `File exceeds the maximum size of ${options.maxFileSize} bytes.`);
    }
    if (info.contentType) {
      const storedMime = normalizeMimeType(info.contentType);
      if (ACTIVE_CONTENT.has(storedMime)) {
        throw new XenonError("UNSUPPORTED_MEDIA_TYPE", `File type "${storedMime}" is not allowed.`);
      }
    }

    const sample =
      info.size > 0
        ? await storage.readRange(key, 0, Math.min(info.size - 1, PRESIGN_SNIFF_BYTES - 1))
        : new Uint8Array(0);
    if (!sample) {
      throw new XenonError("BAD_REQUEST", "Uploaded file was not found in storage.");
    }

    const mimeType = resolveUploadType(sample, filename, declaredMimeType, options.mimeTypes);
    const { width, height } = extractImageDimensions(sample, mimeType);
    return {
      key,
      url: storage.getUrl(key),
      meta: { filename, mimeType, filesize: info.size, width, height },
    };
  } catch (err) {
    await storage.delete(key).catch(() => {});
    throw err;
  }
}

/* ---------------------------------------------------------------------------- signed tokens */

const encoder = new TextEncoder();
const presignKeys = new Map<string, Promise<CryptoKey>>();

function presignHmacKey(secret: string): Promise<CryptoKey> {
  let key = presignKeys.get(secret);
  if (!key) {
    // Domain-separated from BetterAuth and presence tokens.
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(`xenon-presign:${secret}`),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    presignKeys.set(secret, key);
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

export async function signPresignToken(secret: string, payload: PresignTokenPayload): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await presignHmacKey(secret), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** Verifies a presigned upload token (constant-time HMAC + expiry + structure). Returns `null` when invalid. */
export async function verifyPresignToken(
  secret: string,
  token: unknown,
  now = Date.now(),
): Promise<PresignTokenPayload | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await presignHmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(body),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as Partial<PresignTokenPayload>;
    if (
      typeof payload.collection !== "string" ||
      typeof payload.key !== "string" ||
      typeof payload.filename !== "string" ||
      typeof payload.mimeType !== "string" ||
      typeof payload.size !== "number" ||
      !Number.isInteger(payload.size) ||
      payload.size < 0 ||
      (payload.userId !== null && typeof payload.userId !== "string") ||
      (payload.id !== undefined && typeof payload.id !== "string") ||
      typeof payload.exp !== "number" ||
      payload.exp <= now
    ) {
      return null;
    }
    return {
      collection: payload.collection,
      key: payload.key,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      userId: payload.userId,
      ...(payload.id !== undefined ? { id: payload.id } : {}),
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
