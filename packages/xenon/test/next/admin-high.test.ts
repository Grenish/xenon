import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { defineCollection, defineConfig, text, textarea } from "../../src/index";
import type { SearchResult } from "../../src/ui/shared/services";
import { dispatchAdminAction, mergeSessionHeaders, titleFieldKey } from "../../src/next/admin/action";
import { canReadCollection, filterReadableCollections } from "../../src/next/admin/page";
import { getXenon } from "../../src/next/xenon";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function memoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    name: "test-memory",
    async upload(file: { key: string; body: Uint8Array }) {
      files.set(file.key, file.body);
      return { key: file.key, url: `/files/${file.key}` };
    },
    async delete(key: string) {
      files.delete(key);
    },
    getUrl(key: string) {
      return `/files/${key}`;
    },
  };
}

describe("High #7: session cookie header merging after rotation", () => {
  test("mergeSessionHeaders overrides stale cookies and removes cleared cookies while keeping other headers", () => {
    const incoming = new Headers({
      cookie: "better-auth.session_token=old-token",
      "user-agent": "XenonTest/1.0",
    });

    const rotated = mergeSessionHeaders(incoming, "better-auth.session_token=new-token; xenon-theme=dark");
    expect(rotated.get("cookie")).toBe("better-auth.session_token=new-token; xenon-theme=dark");
    expect(rotated.get("user-agent")).toBe("XenonTest/1.0");

    const cleared = mergeSessionHeaders(incoming, "");
    expect(cleared.get("cookie")).toBeNull();
    expect(cleared.get("user-agent")).toBe("XenonTest/1.0");
  });

  test("account.sessions succeeds with rotated session cookie after password change", async () => {
    const cfg = defineConfig({
      collections: [defineCollection({ slug: "posts", fields: { title: text({ required: true }) } })],
      db: memoryAdapter(),
      auth: { secret: "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz", baseURL: "http://localhost:3000" },
    });
    const xenon = getXenon(cfg);
    await xenon.init();
    const auth = (await xenon.getAuth())!;
    const api = auth.api as Record<string, (args: Record<string, unknown>) => Promise<any>>;

    await api.createUser!({ body: { email: "admin@example.com", password: "password123", name: "Admin", role: "admin" } });
    const signInRes = (await api.signInEmail!({
      body: { email: "admin@example.com", password: "password123" },
      returnHeaders: true,
    })) as { headers: Headers };
    const firstCookie = signInRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(firstCookie).toContain("session_token=");

    // Change password with revokeOtherSessions (and verify merged cookie headers resolve active sessions).
    const baseHeaders = new Headers({ cookie: firstCookie, "user-agent": "XenonTest/1.0" });
    const changeRes = (await api.changePassword!({
      body: { currentPassword: "password123", newPassword: "new-password-456", revokeOtherSessions: true },
      headers: baseHeaders,
      returnHeaders: true,
    })) as { headers: Headers };
    const nextCookie = changeRes.headers.get("set-cookie")?.split(";")[0] || firstCookie;

    const merged = mergeSessionHeaders(baseHeaders, nextCookie);
    const sessions = await dispatchAdminAction(cfg, { type: "account.sessions" }, merged);
    expect(sessions.ok).toBe(true);
    if (sessions.ok) {
      expect(Array.isArray(sessions.data)).toBe(true);
      expect((sessions.data as unknown[]).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("High #8: restricted collections access filtering", () => {
  const publicPosts = defineCollection({
    slug: "posts",
    fields: { title: text({ required: true }) },
  });
  const adminAudit = defineCollection({
    slug: "secrets",
    fields: { title: text({ required: true }) },
    access: { read: ({ user }) => user?.role === "admin" },
  });
  const asyncRestricted = defineCollection({
    slug: "private-notes",
    fields: { title: text({ required: true }) },
    access: { read: async ({ user }) => user?.email === "owner@example.com" },
  });
  const cfg = defineConfig({ collections: [publicPosts, adminAudit, asyncRestricted], db: memoryAdapter() });

  test("filterReadableCollections hides collections blocked by sync or async access.read", async () => {
    const editor = { id: "u1", email: "editor@example.com", name: "Ed", role: "editor" as const };
    const admin = { id: "u2", email: "owner@example.com", name: "Owner", role: "admin" as const };

    expect(await canReadCollection(adminAudit, editor)).toBe(false);
    expect(await canReadCollection(adminAudit, admin)).toBe(true);
    expect((await filterReadableCollections(cfg, editor)).map((c) => c.slug)).toEqual(["posts"]);
    expect((await filterReadableCollections(cfg, admin)).map((c) => c.slug)).toEqual(["posts", "secrets", "private-notes"]);
  });
});

describe("High #9: doc.search falls back to first text field when admin.useAsTitle is unset", () => {
  test("titleFieldKey and doc.search match media alt text and untitled collections", async () => {
    const mediaCol = defineCollection({
      slug: "media",
      upload: true,
      fields: {
        alt: text({ required: true }),
        caption: textarea(),
      },
    });
    const authorsCol = defineCollection({
      slug: "authors",
      fields: {
        name: text({ required: true }),
      },
    });
    const cfg = defineConfig({
      collections: [mediaCol, authorsCol],
      db: memoryAdapter(),
      storage: memoryStorage(),
      auth: {
        secret: "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
        apiKeys: [{ key: "test-admin-key", role: "admin", name: "test" }],
      },
    });

    expect(titleFieldKey(mediaCol)).toBe("alt");
    expect(titleFieldKey(authorsCol)).toBe("name");

    const xenon = getXenon(cfg);
    await xenon.create({
      collection: "media",
      data: { alt: "Golden mountain sunset" },
      file: { data: PNG, name: "img001.png", type: "image/png" },
    });
    await xenon.create({
      collection: "authors",
      data: { name: "Ada Lovelace" },
    });

    const headers = new Headers({ authorization: "Bearer test-admin-key" });

    const mediaRes = await dispatchAdminAction(cfg, { type: "doc.search", collection: "media", query: "sunset" }, headers);
    expect(mediaRes.ok).toBe(true);
    if (mediaRes.ok) {
      const data = mediaRes.data as SearchResult;
      expect(data.totalDocs).toBe(1);
      expect(data.docs[0]?.title).toBe("Golden mountain sunset");
    }

    const authorRes = await dispatchAdminAction(cfg, { type: "doc.search", collection: "authors", query: "lovelace" }, headers);
    expect(authorRes.ok).toBe(true);
    if (authorRes.ok) {
      const data = authorRes.data as SearchResult;
      expect(data.totalDocs).toBe(1);
      expect(data.docs[0]?.title).toBe("Ada Lovelace");
    }
  });
});
