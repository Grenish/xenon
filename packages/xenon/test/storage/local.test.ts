import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageAdapter } from "../../src/storage/local";

describe("LocalStorageAdapter", () => {
  let directory: string;
  let storage: LocalStorageAdapter;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "xenon-storage-"));
    storage = new LocalStorageAdapter({ directory: join(directory, "uploads") });
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  test("uploads nested paths, reads exact bytes, and deletes idempotently", async () => {
    const body = new Uint8Array([0, 255, 34, 12]);
    const key = "media/2026/11/photo.png";
    expect(await storage.upload({ key, body, contentType: "image/png", size: body.length })).toEqual({
      key, url: `/api/xenon/_files/${key}`,
    });
    expect(new Uint8Array(await readFile(join(directory, "uploads", key)))).toEqual(body);
    const stored = await storage.read(key);
    expect(stored?.contentType).toBe("image/png");
    expect(stored?.size).toBe(4);
    expect(new Uint8Array(stored?.body as Uint8Array)).toEqual(body);
    await storage.delete(key);
    expect(await storage.read(key)).toBeNull();
    await storage.delete(key);
    await storage.delete("missing/directory/file.jpg");
  });

  test("URL encodes each segment and normalizes trailing base slashes", () => {
    const custom = new LocalStorageAdapter({ directory, baseUrl: "https://cms.example/files///" });
    expect(custom.getUrl("a folder/photo #?%.jpg")).toBe("https://cms.example/files/a%20folder/photo%20%23%3F%25.jpg");
  });

  test.each([
    { key: "photo.JPG", type: "image/jpeg" }, { key: "icon.svg", type: "image/svg+xml" },
    { key: "notes.txt", type: "text/plain" }, { key: "file.pdf", type: "application/pdf" },
    { key: "file", type: "application/octet-stream" }, { key: "file.unknown", type: "application/octet-stream" },
  ])("read infers content type for $key", async ({ key, type }) => {
    await storage.upload({ key, body: new Uint8Array(), contentType: "ignored/in-memory", size: 0 });
    expect((await storage.read(key))?.contentType).toBe(type);
  });

  test.each(["", "/absolute.jpg", "../escape", "a/../escape", "a\\escape", "a//b", "a/", "./a", "C:/escape", "a\0b"])(
    "rejects unsafe key %j for every operation", async (key) => {
      expect(() => storage.getUrl(key)).toThrow("Unsafe storage key");
      await expect(storage.upload({ key, body: new Uint8Array(), contentType: "text/plain", size: 0 })).rejects.toThrow("Unsafe storage key");
      await expect(storage.read(key)).rejects.toThrow("Unsafe storage key");
      await expect(storage.delete(key)).rejects.toThrow("Unsafe storage key");
    },
  );

  test("rejects symbolic links to files and directories outside storage", async () => {
    await mkdir(join(directory, "uploads"));
    await mkdir(join(directory, "outside"));
    await writeFile(join(directory, "outside", "secret.txt"), "secret");
    await symlink(join(directory, "outside"), join(directory, "uploads", "link"));
    await symlink(join(directory, "outside", "secret.txt"), join(directory, "uploads", "file.txt"));
    for (const key of ["link/secret.txt", "file.txt"]) {
      await expect(storage.read(key)).rejects.toThrow("Symlinks");
      await expect(storage.upload({ key, body: new Uint8Array([1]), contentType: "text/plain", size: 1 })).rejects.toThrow("Symlinks");
      await expect(storage.delete(key)).rejects.toThrow("Symlinks");
    }
    expect(await readFile(join(directory, "outside", "secret.txt"), "utf8")).toBe("secret");
  });
});
