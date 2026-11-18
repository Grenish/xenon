import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { S3StorageAdapter } from "../../src/storage/s3";

const options = {
  endpoint: "https://account.r2.cloudflarestorage.com/", bucket: "media",
  accessKeyId: "test-key", secretAccessKey: "test-secret", publicUrl: "https://cdn.example/",
};

describe("S3StorageAdapter (signed requests, no network)", () => {
  let requests: Request[];
  let responseStatus: number;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  beforeEach(() => {
    requests = [];
    responseStatus = 204;
    const fakeFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: responseStatus });
    }, { preconnect: globalThis.fetch.preconnect });
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
  });
  afterEach(() => { fetchSpy.mockRestore(); });

  test("signs path-style R2 uploads with auto region and content headers", async () => {
    const storage = new S3StorageAdapter(options);
    const key = "photos/a #?%.png";
    const body = new Uint8Array([1, 2, 3]);
    expect(await storage.upload({ key, body, contentType: "image/png", size: 3 })).toEqual({
      key, url: "https://cdn.example/photos/a%20%23%3F%25.png",
    });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("PUT");
    expect(request.url).toBe("https://account.r2.cloudflarestorage.com/media/photos/a%20%23%3F%25.png");
    expect(request.headers.get("content-type")).toBe("image/png");
    expect(request.headers.get("content-length")).toBe("3");
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-key\/\d{8}\/auto\/s3\/aws4_request/);
    expect(request.headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(body);
    expect("read" in storage).toBe(false);
  });

  test("prefix applies to both signed object URLs and public URLs", async () => {
    const storage = new S3StorageAdapter({ ...options, prefix: "/site uploads/assets/", region: "us-east-1" });
    expect(storage.getUrl("a/b.jpg")).toBe("https://cdn.example/site%20uploads/assets/a/b.jpg");
    await storage.delete("a/b.jpg");
    expect(requests[0]!.url).toBe("https://account.r2.cloudflarestorage.com/media/site%20uploads/assets/a/b.jpg");
    expect(requests[0]!.method).toBe("DELETE");
    expect(requests[0]!.headers.get("authorization")).toContain("/us-east-1/s3/aws4_request");
  });

  test.each([200, 204, 404])("delete resolves for status %i", async (status) => {
    responseStatus = status;
    await new S3StorageAdapter(options).delete("missing.png");
    expect(requests).toHaveLength(1);
  });

  test.each([400, 403, 500])("failed requests include status %i", async (status) => {
    responseStatus = status;
    const storage = new S3StorageAdapter(options);
    await expect(storage.upload({ key: "file.txt", body: new Uint8Array(), size: 0, contentType: "text/plain" })).rejects.toThrow(String(status));
    await expect(storage.delete("file.txt")).rejects.toThrow(String(status));
  });

  test("upload 404 is a failure", async () => {
    responseStatus = 404;
    await expect(new S3StorageAdapter(options).upload({
      key: "file.txt", body: new Uint8Array(), size: 0, contentType: "text/plain",
    })).rejects.toThrow("404");
  });
});
