import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StorageAdapter, StoredFile, UploadFileInput } from "../adapters/types";
import { encodeKey, keySegments } from "./keys";

export interface LocalStorageOptions {
  directory?: string;
  baseUrl?: string;
}

const mimeTypes: Record<string, string> = {
  avif: "image/avif", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon",
  jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml",
  tif: "image/tiff", tiff: "image/tiff", webp: "image/webp",
  pdf: "application/pdf", json: "application/json", txt: "text/plain", csv: "text/csv",
  html: "text/html", css: "text/css", js: "text/javascript", xml: "application/xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm",
  woff: "font/woff", woff2: "font/woff2", zip: "application/zip",
};

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = "local";
  private readonly directory: string;
  private readonly baseUrl: string;

  constructor(options: LocalStorageOptions = {}) {
    const directory = options.directory ?? ".xenon/uploads";
    // Uploads live on runtime storage; they are not deployment build assets.
    this.directory = resolve(/* turbopackIgnore: true */ process.cwd(), directory);
    this.baseUrl = (options.baseUrl ?? "/api/xenon/_files").replace(/\/+$/, "");
  }

  getUrl(key: string): string {
    return `${this.baseUrl}/${encodeKey(key)}`;
  }

  /** Reject existing symlinks too: a safe-looking key must not escape through a symlink. */
  private async filePath(key: string, createParents = false): Promise<string | null> {
    const segments = keySegments(key);
    if (createParents) await mkdir(/* turbopackIgnore: true */ this.directory, { recursive: true });
    let path = this.directory;
    for (const [index, segment] of segments.entries()) {
      path = join(/* turbopackIgnore: true */ path, segment);
      const parent = index < segments.length - 1;
      if (parent && createParents) {
        try { await mkdir(/* turbopackIgnore: true */ path); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      try {
        const stat = await lstat(/* turbopackIgnore: true */ path);
        if (stat.isSymbolicLink()) throw new Error(`[xenon] Symlinks are not allowed in storage keys: ${key}`);
        if (parent && !stat.isDirectory()) throw new Error(`[xenon] Storage parent is not a directory: ${key}`);
      } catch (error) {
        if (!isMissing(error)) throw error;
        if (!createParents) return null;
      }
    }
    return path;
  }

  async upload(file: UploadFileInput): Promise<{ key: string; url: string }> {
    const path = await this.filePath(file.key, true);
    await writeFile(/* turbopackIgnore: true */ path!, file.body);
    return { key: file.key, url: this.getUrl(file.key) };
  }

  async read(key: string): Promise<StoredFile | null> {
    const path = await this.filePath(key);
    if (!path) return null;
    try {
      const body = await readFile(/* turbopackIgnore: true */ path);
      const extension = key.split(".").at(-1)?.toLowerCase() ?? "";
      return { body, size: body.byteLength, contentType: mimeTypes[extension] ?? "application/octet-stream" };
    } catch (error) {
      if (isMissing(error) || (error as NodeJS.ErrnoException).code === "EISDIR") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const path = await this.filePath(key);
    if (!path) return;
    try { await unlink(/* turbopackIgnore: true */ path); } catch (error) { if (!isMissing(error)) throw error; }
  }
}
