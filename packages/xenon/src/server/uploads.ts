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

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export async function prepareUpload(collection: AnyCollection, file: UploadFile): Promise<PreparedUpload> {
  const options: UploadOptions = typeof collection.upload === "object" ? collection.upload : {};
  const body = file.data instanceof Uint8Array ? file.data : new Uint8Array(await file.data.arrayBuffer());
  const mimeType = (file.type || "application/octet-stream").toLowerCase();

  if (options.mimeTypes?.length && !mimeAllowed(mimeType, options.mimeTypes)) {
    throw new XenonError("UNSUPPORTED_MEDIA_TYPE", `File type "${mimeType}" is not allowed.`);
  }
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
