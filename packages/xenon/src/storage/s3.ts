import { AwsClient } from "aws4fetch";
import type {
  PresignedUploadInput,
  PresignedUploadResult,
  StorageAdapter,
  StoredFileHead,
  UploadFileInput,
} from "../adapters/types";
import { encodeKey } from "./keys";

const DEFAULT_PRESIGN_EXPIRES_SECONDS = 900;
const MAX_PRESIGN_EXPIRES_SECONDS = 604_800; // AWS SigV4 max (7 days)

export interface S3StorageOptions {
  bucket: string;
  endpoint: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  prefix?: string;
}

export class S3StorageAdapter implements StorageAdapter {
  readonly name = "s3";
  private readonly client: AwsClient;
  private readonly endpoint: string;
  private readonly publicUrl: string;
  private readonly prefix: string;
  private readonly bucket: string;

  constructor(options: S3StorageOptions) {
    this.client = new AwsClient({
      accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey,
      region: options.region ?? "auto", service: "s3",
    });
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.publicUrl = options.publicUrl.replace(/\/+$/, "");
    this.bucket = encodeKey(options.bucket);
    const prefix = options.prefix?.replace(/^\/+|\/+$/g, "") ?? "";
    this.prefix = prefix ? `${encodeKey(prefix)}/` : "";
  }

  getUrl(key: string): string {
    return `${this.publicUrl}/${this.prefix}${encodeKey(key)}`;
  }

  private objectUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${this.prefix}${encodeKey(key)}`;
  }

  async upload(file: UploadFileInput): Promise<{ key: string; url: string }> {
    // Fetch accepts ArrayBuffer-backed views, including Node Buffers and subarrays.
    const body = file.body.buffer instanceof ArrayBuffer
      ? new Uint8Array(file.body.buffer, file.body.byteOffset, file.body.byteLength)
      : new Uint8Array(file.body);
    const request = await this.client.sign(this.objectUrl(file.key), {
      method: "PUT", body,
      headers: { "content-type": file.contentType, "content-length": String(file.size) },
    });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`[xenon] S3 upload failed (${response.status}).`);
    return { key: file.key, url: this.getUrl(file.key) };
  }

  async delete(key: string): Promise<void> {
    const response = await fetch(await this.client.sign(this.objectUrl(key), { method: "DELETE" }));
    if (!response.ok && response.status !== 404) throw new Error(`[xenon] S3 delete failed (${response.status}).`);
  }

  async createPresignedUpload(input: PresignedUploadInput): Promise<PresignedUploadResult> {
    const rawExpires = input.expiresIn ?? DEFAULT_PRESIGN_EXPIRES_SECONDS;
    if (!Number.isFinite(rawExpires) || rawExpires < 1) {
      throw new RangeError("[xenon] Presigned upload expiresIn must be a positive number of seconds.");
    }
    const expiresIn = Math.min(MAX_PRESIGN_EXPIRES_SECONDS, Math.floor(rawExpires));
    if (input.size !== undefined && (!Number.isInteger(input.size) || input.size < 0)) {
      throw new RangeError("[xenon] Presigned upload size must be a non-negative integer.");
    }
    const url = new URL(this.objectUrl(input.key));
    url.searchParams.set("X-Amz-Expires", String(expiresIn));

    // Sign content-type (and content-length when given) into the SigV4 query signature so S3/R2
    // refuses uploads with spoofed Content-Type or mismatched size before `_complete` runs.
    const signHeaders: Record<string, string> = { "content-type": input.contentType };
    if (input.size !== undefined) signHeaders["content-length"] = String(input.size);

    const signed = await this.client.sign(url.toString(), {
      method: "PUT",
      headers: signHeaders,
      aws: { signQuery: true, allHeaders: true },
    });

    return {
      key: input.key,
      url: signed.url,
      method: "PUT",
      // Return only content-type to clients: browsers compute Content-Length automatically from the body
      // and treat explicit Content-Length as a forbidden fetch header.
      headers: { "content-type": input.contentType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async head(key: string): Promise<StoredFileHead | null> {
    const response = await fetch(await this.client.sign(this.objectUrl(key), { method: "HEAD" }));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`[xenon] S3 head failed (${response.status}).`);
    const rawLength = response.headers.get("content-length");
    const size = rawLength !== null ? Number(rawLength) : NaN;
    if (!Number.isFinite(size) || size < 0) {
      throw new Error("[xenon] S3 head response is missing a valid content-length.");
    }
    return {
      size,
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
    };
  }

  async readRange(key: string, start: number, end: number): Promise<Uint8Array | null> {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new RangeError(`[xenon] Invalid byte range: ${start}-${end}.`);
    }
    const signed = await this.client.sign(this.objectUrl(key), {
      method: "GET",
      headers: { range: `bytes=${start}-${end}` },
    });
    const controller = new AbortController();
    const response = await fetch(signed, { signal: controller.signal });
    if (response.status === 404) return null;
    // S3/R2 returns 416 Range Not Satisfiable for empty (0-byte) objects.
    if (response.status === 416) return new Uint8Array(0);
    if (!response.ok) throw new Error(`[xenon] S3 range read failed (${response.status}).`);

    const maxBytes = end - start + 1;
    const rawLength = response.headers.get("content-length");
    const declaredLength = rawLength !== null ? Number(rawLength) : NaN;
    if (!response.body || (Number.isFinite(declaredLength) && declaredLength >= 0 && declaredLength <= maxBytes)) {
      const buf = new Uint8Array(await response.arrayBuffer());
      return buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf;
    }
    // Cap buffered bytes even if a proxy ignores the Range header and streams a full 200 body.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = maxBytes - total;
        const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        chunks.push(slice);
        total += slice.byteLength;
        if (total >= maxBytes) {
          // Do not await cancel(): tee'd streams (e.g. Next.js patched fetch) can block cancel()
          // until the sibling branch drains or is GC'd; aborting tears down the socket immediately.
          void reader.cancel().catch(() => {});
          controller.abort();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (chunks.length === 0) return new Uint8Array(0);
    if (chunks.length === 1) return chunks[0]!;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}
