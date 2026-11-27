import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { memoryAdapter } from "../../src/adapters/memory";
import {
  mergeLivePreviewData,
  subscribeLivePreview,
  XENON_PREVIEW_CHANNEL,
} from "../../src/core/preview-protocol";
import { dispatchAdminAction } from "../../src/http/admin-action";
import { createHandler } from "../../src/http/handler";
import { defineCollection, defineConfig, defineGlobal, text, XenonConfigError } from "../../src/index";
import { createPreviewHandler, isDraftPreview } from "../../src/next/preview";
import {
  isPreviewRequest,
  PREVIEW_COOKIE_NAME,
  resolvePreviewUrl,
  signPreviewToken,
  verifyPreviewRequest,
  verifyPreviewToken,
} from "../../src/server/preview";
import { createXenon } from "../../src/server/xenon";
import { AdminShell } from "../../src/ui/admin/shell";
import { AdminRuntimeProvider } from "../../src/ui/admin/runtime";
import { DocumentEditor } from "../../src/ui/form/document-editor";
import { GlobalEditor } from "../../src/ui/form/global-editor";
import { PreviewSplitPane } from "../../src/ui/form/preview-pane";
import { AdminProvider } from "../../src/ui/shared/admin-context";
import { toClientCollection, toClientGlobal } from "../../src/ui/shared/client-config";
import { AdminRouterProvider, createHistoryRouter } from "../../src/ui/shared/router";
import type { AdminServices } from "../../src/ui/shared/services";

const SECRET = "preview-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

function makeFixture() {
  const posts = defineCollection({
    slug: "posts",
    slugFrom: "title",
    admin: {
      previewUrl: (doc) => (doc.slug ? `/blog/${doc.slug}` : null),
    },
    fields: {
      title: text({ required: true }),
    },
  });

  const privateDocs = defineCollection({
    slug: "private-docs",
    access: {
      read: ({ user }) => user?.role === "admin",
    },
    admin: {
      previewUrl: (doc) => `/private/${doc.id}`,
    },
    fields: {
      title: text({ required: true }),
    },
  });

  const plain = defineCollection({
    slug: "plain",
    fields: { title: text({ required: true }) },
  });

  const site = defineGlobal({
    slug: "site",
    label: "Site Settings",
    admin: {
      previewUrl: (doc) => (doc.tagline ? `/?tagline=${encodeURIComponent(doc.tagline)}` : "/"),
    },
    fields: {
      title: text({ required: true }),
      tagline: text(),
    },
  });

  const db = memoryAdapter();
  const config = defineConfig({
    collections: [posts, privateDocs, plain],
    globals: [site],
    db,
    auth: {
      secret: SECRET,
      baseURL: "http://localhost:3000",
      trustedOrigins: ["https://preview.example.com"],
      apiKeys: [
        { key: "admin-key", role: "admin", name: "admin" },
        { key: "editor-key", role: "editor", name: "editor" },
      ],
    },
  });
  const xenon = createXenon(config);
  const handler = createHandler(config, { xenon });
  return { config, xenon, handler, posts, privateDocs, plain, site };
}

describe("Live Preview (#14) config, tokens, and open-redirect protection", () => {
  test("validates admin.previewUrl is a function on collections and globals", () => {
    expect(() =>
      defineConfig({
        collections: [
          defineCollection({
            slug: "bad",
            fields: { title: text() },
            // @ts-expect-error runtime validation check
            admin: { previewUrl: "/static" },
          }),
        ],
      }),
    ).toThrow(XenonConfigError);

    expect(() =>
      defineConfig({
        collections: [defineCollection({ slug: "ok", fields: { title: text() } })],
        globals: [
          defineGlobal({
            slug: "bad-global",
            fields: { title: text() },
            // @ts-expect-error runtime validation check
            admin: { previewUrl: 123 },
          }),
        ],
      }),
    ).toThrow(XenonConfigError);
  });

  test("signs and verifies preview tokens; rejects tampered, malformed, wrong-secret, and expired tokens", async () => {
    const token = await signPreviewToken(
      SECRET,
      { kind: "collection", slug: "posts", id: "doc-1", url: "/blog/hello", userId: "user-1" },
      60_000,
      1_000_000,
    );

    expect(await verifyPreviewToken(SECRET, token, 1_030_000)).toEqual({
      kind: "collection",
      slug: "posts",
      id: "doc-1",
      url: "/blog/hello",
      userId: "user-1",
      exp: 1_060_000,
    });
    expect(await verifyPreviewToken(SECRET, token, 1_060_001)).toBeNull();
    expect(await verifyPreviewToken("other-secret-0123456789-other-secret", token, 1_030_000)).toBeNull();
    expect(await verifyPreviewToken(SECRET, `${token}x`, 1_030_000)).toBeNull();
    expect(await verifyPreviewToken(SECRET, "not-a-token", 1_030_000)).toBeNull();
  });

  test("resolvePreviewUrl allows relative paths and trusted origins; blocks open redirects", () => {
    const { config } = makeFixture();

    expect(resolvePreviewUrl("/blog/hello?draft=1#top", config, "http://localhost:3000/api/xenon/_preview")).toEqual({
      url: "/blog/hello?draft=1#top",
      targetOrigin: "http://localhost:3000",
    });
    expect(resolvePreviewUrl("https://preview.example.com/posts/1", config)).toEqual({
      url: "https://preview.example.com/posts/1",
      targetOrigin: "https://preview.example.com",
    });

    for (const bad of [
      "",
      "//evil.com/phish",
      "/\\evil.com",
      "https://evil.com/steal",
      "javascript:alert(1)",
      "data:text/html,<h1>hi</h1>",
      "/good\r\nSet-Cookie: evil=1",
    ]) {
      expect(() => resolvePreviewUrl(bad, config, "http://localhost:3000/api/xenon/_preview")).toThrow();
    }
  });
});

describe("Live Preview (#14) HTTP routes, cookie verification, Next.js helper, and admin action", () => {
  test("POST /_preview, GET /_preview?token=..., verifyPreviewRequest, and /_preview/exit end-to-end", async () => {
    const { config, xenon, handler } = makeFixture();

    const draftPost = await xenon.create({
      collection: "posts",
      data: { title: "Draft Preview Story" },
      draft: true,
      overrideAccess: true,
    });
    const privateDoc = await xenon.create({
      collection: "private-docs",
      data: { title: "Top Secret" },
      draft: true,
      overrideAccess: true,
    });

    // Unauthenticated POST /_preview -> 401 no-store.
    const unauth = await handler(
      new Request("http://localhost:3000/api/xenon/_preview", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ collection: "posts", id: draftPost.id }),
      }),
    );
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("cache-control")).toBe("private, no-store");

    // Access control: editor cannot create a preview session for admin-only collection.
    const forbidden = await handler(
      new Request("http://localhost:3000/api/xenon/_preview", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer editor-key" },
        body: JSON.stringify({ collection: "private-docs", id: privateDoc.id }),
      }),
    );
    expect(forbidden.status).toBe(403);

    // Collection without previewUrl -> 400.
    const noPreview = await handler(
      new Request("http://localhost:3000/api/xenon/_preview", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer admin-key" },
        body: JSON.stringify({ collection: "plain" }),
      }),
    );
    expect(noPreview.status).toBe(400);

    // Valid collection preview session (including unsaved slug override).
    const createdRes = await handler(
      new Request("http://localhost:3000/api/xenon/_preview", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer admin-key" },
        body: JSON.stringify({ collection: "posts", id: draftPost.id, slug: "custom-preview-slug" }),
      }),
    );
    expect(createdRes.status).toBe(200);
    expect(createdRes.headers.get("cache-control")).toBe("private, no-store");
    const session = (await createdRes.json()) as {
      token: string;
      url: string;
      enterUrl: string;
      targetOrigin: string;
    };
    expect(session.url).toBe("/blog/custom-preview-slug");
    expect(session.targetOrigin).toBe("http://localhost:3000");
    expect(session.enterUrl).toStartWith("/api/xenon/_preview?token=");

    // When previewUrl(doc) returns null (e.g. unsaved doc with no slug), returns null fields cleanly.
    const nullUrlRes = await handler(
      new Request("http://localhost:3000/api/xenon/_preview", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer admin-key" },
        body: JSON.stringify({ collection: "posts", data: { title: "No Slug Yet" } }),
      }),
    );
    expect(nullUrlRes.status).toBe(200);
    expect(await nullUrlRes.json()).toEqual({ token: null, url: null, enterUrl: null, targetOrigin: null });

    // Global preview session evaluates unsaved `data`.
    const globalRes = await handler(
      new Request("http://localhost:3000/api/xenon/_preview", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer admin-key" },
        body: JSON.stringify({ global: "site", data: { title: "Xenon", tagline: "Fast CMS" } }),
      }),
    );
    expect(globalRes.status).toBe(200);
    expect(((await globalRes.json()) as { url: string }).url).toBe("/?tagline=Fast%20CMS");

    // GET /_preview with bad token -> 401.
    const badEnter = await handler(new Request("http://localhost:3000/api/xenon/_preview?token=tampered"));
    expect(badEnter.status).toBe(401);
    expect(badEnter.headers.get("cache-control")).toBe("private, no-store");

    // GET /_preview with valid token -> 307 redirect + HttpOnly xenon-preview cookie.
    const enterRes = await handler(new Request(`https://localhost:3000${session.enterUrl}`));
    expect(enterRes.status).toBe(307);
    expect(enterRes.headers.get("location")).toBe("/blog/custom-preview-slug");
    expect(enterRes.headers.get("cache-control")).toBe("private, no-store");
    const setCookie = enterRes.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${PREVIEW_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");

    // Cookie verifies on subsequent site requests (framework-agnostic helper + Next.js helper).
    const cookiePair = setCookie.split(";")[0]!;
    const siteHeaders = new Headers({ cookie: cookiePair });
    const verified = await verifyPreviewRequest(config, siteHeaders);
    expect(verified?.kind).toBe("collection");
    expect(verified?.slug).toBe("posts");
    expect(verified?.id).toBe(draftPost.id);
    expect(await isPreviewRequest(config, new Request("http://localhost:3000/blog/custom-preview-slug", { headers: siteHeaders }))).toBe(true);
    expect(await isDraftPreview(config, siteHeaders)).toBe(true);
    expect(await isPreviewRequest(config, new Request("http://localhost:3000/blog/custom-preview-slug"))).toBe(false);

    // Query-param fallback (?xenon_preview=<token>) also verifies on Request.
    expect(await isPreviewRequest(config, new Request(`http://localhost:3000/blog/custom-preview-slug?xenon_preview=${encodeURIComponent(session.token)}`))).toBe(true);

    // GET /_preview/exit clears cookie and redirects safely; rejects open redirects.
    const badExit = await handler(new Request("http://localhost:3000/api/xenon/_preview/exit?redirect=//evil.com"));
    expect(badExit.status).toBe(400);

    const exitGet = await handler(new Request("http://localhost:3000/api/xenon/_preview/exit?redirect=/blog/custom-preview-slug"));
    expect(exitGet.status).toBe(307);
    expect(exitGet.headers.get("location")).toBe("/blog/custom-preview-slug");
    expect(exitGet.headers.get("set-cookie")).toContain(`${PREVIEW_COOKIE_NAME}=;`);
    expect(exitGet.headers.get("set-cookie")).toContain("Max-Age=0");

    // POST /_preview/exit clears cookie and blocks untrusted Origin.
    const exitBadOrigin = await handler(
      new Request("http://localhost:3000/api/xenon/_preview/exit", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(exitBadOrigin.status).toBe(403);

    const exitPost = await handler(
      new Request("http://localhost:3000/api/xenon/_preview/exit", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(exitPost.status).toBe(200);
    expect(exitPost.headers.get("set-cookie")).toContain("Max-Age=0");

    // Standalone Next.js createPreviewHandler works cleanly outside Next.js request scope too.
    const nextPreview = createPreviewHandler(config);
    const nextEnter = await nextPreview.GET(new Request(`http://localhost:3000/api/preview?token=${encodeURIComponent(session.token)}`));
    expect(nextEnter.status).toBe(307);
    expect(nextEnter.headers.get("location")).toBe("/blog/custom-preview-slug");
    expect(nextEnter.headers.get("set-cookie")).toContain(`${PREVIEW_COOKIE_NAME}=`);

    const nextExit = await nextPreview.POST(new Request("http://localhost:3000/api/preview", { method: "POST" }));
    expect(nextExit.status).toBe(200);
    expect(nextExit.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("preview.url admin action resolves collection & global URLs with origin from headers", async () => {
    const { config, xenon } = makeFixture();
    const post = await xenon.create({
      collection: "posts",
      data: { title: "Action Preview" },
      draft: true,
      overrideAccess: true,
    });
    const headers = new Headers({
      authorization: "Bearer admin-key",
      origin: "http://localhost:3000",
    });

    const res = await dispatchAdminAction(
      config,
      { type: "preview.url", kind: "collection", slug: "posts", id: post.id },
      headers,
      { xenon },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const info = res.data as { url: string; enterUrl: string; targetOrigin: string | null };
      expect(info.url).toBe("/blog/action-preview");
      expect(info.targetOrigin).toBe("http://localhost:3000");
      expect(info.enterUrl).toStartWith("/api/xenon/_preview?token=");
    }

    const globalRes = await dispatchAdminAction(
      config,
      { type: "preview.url", kind: "global", slug: "site", data: { title: "Site", tagline: "Hello" } },
      headers,
      { xenon },
    );
    expect(globalRes.ok).toBe(true);
    if (globalRes.ok) {
      expect((globalRes.data as { url: string }).url).toBe("/?tagline=Hello");
    }
  });
});

describe("Live Preview (#14) client protocol & Admin UI integration", () => {
  test("mergeLivePreviewData updates edited fields while preserving unchanged populated relations", () => {
    const initial = {
      id: "p1",
      title: "Original",
      author: { id: "a1", name: "Ada" },
      tags: [{ id: "t1", label: "News" }, { id: "t2", label: "CMS" }],
    };

    const updatedSameRelations = mergeLivePreviewData(initial, {
      title: "Live Typed Title",
      author: "a1",
      tags: ["t1", "t2"],
    });
    expect(updatedSameRelations).toEqual({
      id: "p1",
      title: "Live Typed Title",
      author: { id: "a1", name: "Ada" },
      tags: [{ id: "t1", label: "News" }, { id: "t2", label: "CMS" }],
    });

    const updatedChangedRelation = mergeLivePreviewData<Record<string, unknown>>(initial, {
      title: "Live Typed Title",
      author: "a2",
      tags: ["t1"],
    });
    expect(updatedChangedRelation.author).toBe("a2");
    expect(updatedChangedRelation.tags).toEqual(["t1"]);
  });

  test("subscribeLivePreview verifies origin, filters by target, sends ready handshake, and unsubscribes cleanly", () => {
    const origWindow = globalThis.window;
    const listeners = new Set<(event: MessageEvent) => void>();
    const postedToParent: { message: unknown; targetOrigin: string }[] = [];

    const parentMock = {
      postMessage(message: unknown, targetOrigin: string) {
        postedToParent.push({ message, targetOrigin });
      },
    };
    const winMock = {
      location: { origin: "https://site.example.com" },
      parent: parentMock,
      addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: winMock });

    try {
      const received: Record<string, unknown>[] = [];
      const unsubscribe = subscribeLivePreview({
        serverURL: "https://cms.example.com/admin",
        collection: "posts",
        id: "post-1",
        onData: (data) => received.push(data),
      });

      // Sent ready handshake specifically to cms.example.com (never "*").
      expect(postedToParent).toHaveLength(1);
      expect(postedToParent[0]?.targetOrigin).toBe("https://cms.example.com");
      expect(postedToParent[0]?.message).toMatchObject({
        channel: XENON_PREVIEW_CHANNEL,
        type: "xenon:preview:ready",
        kind: "collection",
        slug: "posts",
        id: "post-1",
      });

      const dispatch = (origin: string, data: unknown) => {
        for (const fn of listeners) fn({ origin, data } as MessageEvent);
      };

      // Wrong origin is ignored.
      dispatch("https://evil.example.com", {
        channel: XENON_PREVIEW_CHANNEL,
        type: "xenon:preview:update",
        kind: "collection",
        slug: "posts",
        id: "post-1",
        data: { title: "Evil" },
      });
      // Wrong id is ignored.
      dispatch("https://cms.example.com", {
        channel: XENON_PREVIEW_CHANNEL,
        type: "xenon:preview:update",
        kind: "collection",
        slug: "posts",
        id: "post-2",
        data: { title: "Other Doc" },
      });
      // Exact match is delivered.
      dispatch("https://cms.example.com", {
        channel: XENON_PREVIEW_CHANNEL,
        type: "xenon:preview:update",
        kind: "collection",
        slug: "posts",
        id: "post-1",
        data: { title: "Trusted Live Edit" },
      });

      expect(received).toEqual([{ title: "Trusted Live Edit" }]);

      unsubscribe();
      expect(listeners.size).toBe(0);
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: origWindow });
    }
  });

  test("client config projects hasPreview without leaking functions, and editors + PreviewSplitPane SSR cleanly", () => {
    const { posts, plain, site } = makeFixture();
    const clientPosts = toClientCollection(posts);
    const clientPlain = toClientCollection(plain);
    const clientSite = toClientGlobal(site);

    expect(clientPosts.admin.hasPreview).toBe(true);
    expect(clientPlain.admin.hasPreview).toBe(false);
    expect(clientSite.admin.hasPreview).toBe(true);
    // Must remain 100% JSON-serializable.
    expect(() => JSON.stringify({ clientPosts, clientPlain, clientSite })).not.toThrow();

    const services: AdminServices = {
      save: async () => ({ ok: false, error: { code: "BAD_REQUEST", message: "noop" } }),
      get: async () => ({ ok: false, error: { code: "BAD_REQUEST", message: "noop" } }),
      unpublish: async () => ({ ok: false, error: { code: "BAD_REQUEST", message: "noop" } }),
      remove: async () => ({ ok: false, error: { code: "BAD_REQUEST", message: "noop" } }),
      search: async () => ({ ok: true, data: { docs: [], totalDocs: 0, page: 1, hasNextPage: false } }),
      upload: async () => ({ ok: false, error: { code: "BAD_REQUEST", message: "noop" } }),
      saveGlobal: async () => ({ ok: false, error: { code: "BAD_REQUEST", message: "noop" } }),
      getGlobal: async () => ({ ok: true, data: null }),
      unpublishGlobal: async () => ({ ok: false, error: { code: "BAD_REQUEST", message: "noop" } }),
      versions: async () => ({ ok: true, data: { docs: [], totalDocs: 0, page: 1, hasNextPage: false } }),
      restoreVersion: async () => ({ ok: false, error: { code: "BAD_REQUEST", message: "noop" } }),
      schedule: async () => ({ ok: false, error: { code: "BAD_REQUEST", message: "noop" } }),
      previewUrl: async () => ({
        ok: true,
        data: { url: "/blog/hello", enterUrl: "/api/xenon/_preview?token=abc", targetOrigin: "http://localhost:3000" },
      }),
    };

    const wrap = (children: React.ReactNode, pathname: string) => (
      <AdminRouterProvider router={createHistoryRouter({ initialPathname: pathname })}>
        <AdminRuntimeProvider basePath="/admin" apiPath="/api/xenon" theme="light">
          <AdminProvider
            value={{
              basePath: "/admin",
              apiPath: "/api/xenon",
              collections: [clientPosts, clientPlain],
              globals: [clientSite],
              user: { id: "u1", email: "admin@example.com", name: "Admin", role: "admin" },
              services,
            }}
          >
            <AdminShell>{children}</AdminShell>
          </AdminProvider>
        </AdminRuntimeProvider>
      </AdminRouterProvider>
    );

    const postHtml = renderToStaticMarkup(wrap(<DocumentEditor collection={clientPosts} doc={null} />, "/admin/collections/posts/new"));
    expect(postHtml).toContain("New post");
    expect(postHtml).not.toContain("data-xe-preview-pane");

    const globalHtml = renderToStaticMarkup(wrap(<GlobalEditor global={clientSite} doc={null} />, "/admin/globals/site"));
    expect(globalHtml).toContain("Site Settings");

    const splitHtml = renderToStaticMarkup(
      wrap(
        <PreviewSplitPane
          open
          kind="collection"
          slug="posts"
          liveDoc={{ title: "Hello" }}
          formData={{ title: "Hello" }}
          onClose={() => {}}
        >
          <div>Editor Content</div>
        </PreviewSplitPane>,
        "/admin/collections/posts/new",
      ),
    );
    expect(splitHtml).toContain("data-xe-preview-pane");
    expect(splitHtml).toContain("Editor Content");
    expect(splitHtml).toContain("Desktop");
    expect(splitHtml).toContain("Tablet (768px)");
    expect(splitHtml).toContain("Mobile (390px)");
  });
});
