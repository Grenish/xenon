import { AwsClient } from "aws4fetch";
import type { StorageAdapter, UploadFileInput } from "../adapters/types";
import { encodeKey } from "./keys";

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
}
