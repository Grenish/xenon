import { imageSize } from "image-size";
import { XenonError } from "../core/errors";
import type { AnyCollection, UploadData, UploadOptions } from "../core/types";
import type { UploadFile } from "./types";

export interface PreparedUpload {
  key: string;
  body: Uint8Array;
  meta: Omit<UploadData, "url">;
}

function safeFileName(name: string): string {
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
  if (ACTIVE_CONTENT.has(declared)) reject(`File type "${declared}" is not allowed.`);

  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  // Active-content extensions are refused whatever the bytes or the declared type say: a file served from our origin
  // under one of these names can run script.
  if (ACTIVE_EXTENSIONS.has(ext)) reject(`File extension ".${ext}" is not allowed.`);
  // Markup in the leading bytes is refused too, so a text file can't be stored as an innocent image type.
  if (hasActiveMarkup(body)) reject("File contents look like HTML, SVG or XML, which are not allowed.");

  const sniffed = sniffMimeType(body);
  if (sniffed) {
    if (declared !== "application/octet-stream" && declared !== sniffed) {
      reject(`File contents are ${sniffed}, not the declared type "${declared}".`);
    }
    // A recognized file must carry an extension of its own type: a PNG named evil.html, or photo.bin, is refused.
    if (ext && EXTENSION_TYPES[ext] !== sniffed) {
      reject(`File extension ".${ext}" does not match its contents (${sniffed}).`);
    }
  } else if (declared === "application/octet-stream" || !declared) {
    // Unrecognized bytes with no declared type: allowed only when the collection accepts any type.
    if (allowed?.length) reject(`File type "application/octet-stream" is not allowed.`);
    return "application/octet-stream";
  }

  // A type we can identify must be backed by matching bytes; a declared image/PDF with unrecognized bytes is refused.
  if (!sniffed && SNIFFABLE.has(declared)) reject(`File contents do not match the declared type "${declared}".`);

  const effective = sniffed ?? declared;
  if (ACTIVE_CONTENT.has(effective)) reject(`File type "${effective}" is not allowed.`);
  if (allowed?.length && !mimeAllowed(effective, allowed)) reject(`File type "${effective}" is not allowed.`);
  return effective;
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export async function prepareUpload(collection: AnyCollection, file: UploadFile): Promise<PreparedUpload> {
  const options: UploadOptions = typeof collection.upload === "object" ? collection.upload : {};
  const body = file.data instanceof Uint8Array ? file.data : new Uint8Array(await file.data.arrayBuffer());
  const declared = (file.type || "application/octet-stream").toLowerCase();
  const mimeType = resolveUploadType(body, file.name, declared, options.mimeTypes);
  if (options.maxFileSize !== undefined && body.byteLength > options.maxFileSize) {
    throw new XenonError("PAYLOAD_TOO_LARGE", `File exceeds the maximum size of ${options.maxFileSize} bytes.`);
  }

  let width: number | null = null;
  let height: number | null = null;
  if (mimeType.startsWith("image/")) {
    try {
      const dims = imageSize(body);
      width = dims.width ?? null;
      height = dims.height ?? null;
    } catch {
      // Not a parseable image (e.g. SVG without dimensions) — leave dimensions empty.
    }
  }

  const filename = safeFileName(file.name);
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return {
    key: `${collection.slug}/${now.getUTCFullYear()}/${month}/${randomId()}-${filename}`,
    body,
    meta: { filename, mimeType, filesize: body.byteLength, width, height },
  };
}
