import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { memoryAdapter } from "../../src/adapters/memory";
import { defineCollection, defineConfig, defineGlobal, group, relation, text, boolean } from "../../src/index";
import { createHandler, loadAdminData } from "../../src/http";
import { createXenon } from "../../src/server";
import { GLOBALS_COLLECTION } from "../../src/core/types";
import { AdminRoot, GlobalEditor, type AdminRouter } from "../../src/ui/client";
import { toClientCollection, toClientGlobal } from "../../src/ui/shared/client-config";

const ORIGIN = "http://localhost:3000";

function makeFixture() {
  const pages = defineCollection({
    slug: "pages",
    slugFrom: "title",
    fields: { title: text({ required: true }) },
  });
  const secretPages = defineCollection({
    slug: "secret-pages",
    fields: { title: text({ required: true }) },
    access: { read: ({ user }) => user?.role === "admin" },
  });
  const siteSettings = defineGlobal({
    slug: "site-settings",
    label: "Site Settings",
    admin: { description: "Global site identity and metadata" },
    fields: {
      siteName: text({ required: true }),
      tagline: text({ defaultValue: "Hello" }),
      homePage: relation({ relationTo: "pages" }),
      secretPage: relation({ relationTo: "secret-pages" }),
      seo: group({ fields: { titleSuffix: text() } }),
    },
  });
  const footer = defineGlobal({
    slug: "footer",
    label: "Footer",
    drafts: false,
    admin: { group: "Navigation" },
    fields: {
      copyright: text({ required: true }),
      showLinks: boolean({ defaultValue: true, admin: { position: "sidebar" } }),
    },
  });
  const adminOnly = defineGlobal({
    slug: "admin-only",
    label: "Admin Only",
    fields: { flag: boolean({ defaultValue: false }) },
    access: {
      read: ({ user }) => user?.role === "admin",
      update: ({ user }) => user?.role === "admin",
    },
  });

  const config = defineConfig({
    collections: [pages, secretPages],
    globals: [siteSettings, footer, adminOnly],
    db: memoryAdapter(),
    auth: {
      secret: "test-secret-for-globals-http-suite-32chars!",
      baseURL: ORIGIN,
      apiKeys: [
        { key: "admin-key", role: "admin", name: "Admin CI" },
        { key: "editor-key", role: "editor", name: "Editor CI" },
      ],
    },
  });

  const xenon = createXenon(config);
  const handler = createHandler(config, { xenon });
  return { config, xenon, handler, pages, siteSettings, footer, adminOnly };
}

function req(path: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

describe("REST API: /{api}/globals/{slug}", () => {
  test("GET, HEAD, ETag/304, PATCH, If-Match, draft, populate, select, unpublish, and cache safety", async () => {
    const { handler, xenon } = makeFixture();
    const adminAuth = { authorization: "Bearer admin-key" };
    const editorAuth = { authorization: "Bearer editor-key" };

    // Before first save: GET returns 404.
    expect((await handler(req("/api/xenon/globals/site-settings"))).status).toBe(404);
    expect((await handler(req("/api/xenon/globals"))).status).toBe(404);
    expect((await handler(req("/api/xenon/globals/unknown"))).status).toBe(404);

    // Unauthenticated PATCH fails with 401; non-JSON returns 415.
    expect(
      (await handler(req("/api/xenon/globals/site-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteName: "No Auth" }),
      }))).status,
    ).toBe(401);

    expect(
      (await handler(req("/api/xenon/globals/site-settings", {
        method: "PATCH",
        headers: { ...adminAuth, "content-type": "text/plain" },
        body: "nope",
      }))).status,
    ).toBe(415);

    // Unsupported methods on globals return 404.
    expect((await handler(req("/api/xenon/globals/site-settings", { method: "DELETE", headers: adminAuth }))).status).toBe(404);
    expect((await handler(req("/api/xenon/globals/site-settings", { method: "POST", headers: adminAuth }))).status).toBe(404);

    const home = await xenon.create({ collection: "pages", data: { title: "Welcome" } });
    const secret = await xenon.create({ collection: "secret-pages", data: { title: "Classified" } });

    // Save draft via PATCH ?draft=true (missing required siteName is allowed in draft).
    const draftRes = await handler(
      req("/api/xenon/globals/site-settings?draft=true", {
        method: "PATCH",
        headers: { ...editorAuth, "content-type": "application/json" },
        body: JSON.stringify({ tagline: "Draft tag", homePage: home.id, secretPage: secret.id, seo: { titleSuffix: " | Site" } }),
      }),
    );
    expect(draftRes.status).toBe(200);
    const draftDoc = (await draftRes.json()) as { status: string; tagline: string; updatedAt: string };
    expect(draftDoc.status).toBe("draft");
    expect(draftDoc.tagline).toBe("Draft tag");

    // Live GET is still 404; draft GET requires auth & sets private, no-store.
    expect((await handler(req("/api/xenon/globals/site-settings"))).status).toBe(404);
    expect((await handler(req("/api/xenon/globals/site-settings?draft=true"))).status).toBe(401);
    const authedDraftGet = await handler(req("/api/xenon/globals/site-settings?draft=true", { headers: editorAuth }));
    expect(authedDraftGet.status).toBe(200);
    expect(authedDraftGet.headers.get("cache-control")).toBe("private, no-store");

    // Publish via PATCH (with matching If-Match).
    const pubRes = await handler(
      req("/api/xenon/globals/site-settings", {
        method: "PATCH",
        headers: { ...editorAuth, "content-type": "application/json", "if-match": `"${draftDoc.updatedAt}"` },
        body: JSON.stringify({ siteName: "Acme Corp" }),
      }),
    );
    expect(pubRes.status).toBe(200);
    const pubDoc = (await pubRes.json()) as { id: string; slug: string; status: string; siteName: string; tagline: string; updatedAt: string };
    expect(pubDoc.slug).toBe("site-settings");
    expect(pubDoc.status).toBe("published");
    expect(pubDoc.siteName).toBe("Acme Corp");
    expect(pubDoc.tagline).toBe("Draft tag");

    // Stale If-Match returns 409 CONFLICT.
    const staleRes = await handler(
      req("/api/xenon/globals/site-settings", {
        method: "PATCH",
        headers: { ...editorAuth, "content-type": "application/json", "if-match": `"${draftDoc.updatedAt}"` },
        body: JSON.stringify({ siteName: "Stale" }),
      }),
    );
    expect(staleRes.status).toBe(409);

    // Public GET returns strong ETag + public Cache-Control; If-None-Match -> 304; HEAD has empty body.
    const getRes = await handler(req("/api/xenon/globals/site-settings"));
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const etag = getRes.headers.get("etag")!;
    expect(etag).toMatch(/^"[a-f0-9]+"$/);

    const notMod = await handler(req("/api/xenon/globals/site-settings", { headers: { "if-none-match": etag } }));
    expect(notMod.status).toBe(304);

    const headRes = await handler(req("/api/xenon/globals/site-settings", { method: "HEAD" }));
    expect(headRes.status).toBe(200);
    expect(await headRes.text()).toBe("");
    expect(headRes.headers.get("etag")).toBe(etag);

    // Select + Populate over REST.
    const popRes = await handler(
      req("/api/xenon/globals/site-settings?select=siteName,seo.titleSuffix&populate[homePage][select][title]=true"),
    );
    expect(popRes.status).toBe(200);
    expect(popRes.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(await popRes.json()).toEqual({
      id: pubDoc.id,
      siteName: "Acme Corp",
      seo: { titleSuffix: " | Site" },
      homePage: { id: home.id, title: "Welcome" },
    });

    // Populating a read-restricted collection forces private, no-store and checks target access.
    const restrictedAnon = await handler(req("/api/xenon/globals/site-settings?populate=secretPage"));
    expect(restrictedAnon.status).toBe(401);
    expect(restrictedAnon.headers.get("cache-control")).toBe("private, no-store");

    const restrictedAdmin = await handler(req("/api/xenon/globals/site-settings?populate=secretPage", { headers: adminAuth }));
    expect(restrictedAdmin.status).toBe(200);
    expect(restrictedAdmin.headers.get("cache-control")).toBe("private, no-store");
    expect(restrictedAdmin.headers.get("vary")).toContain("Authorization");
    const restrictedBody = (await restrictedAdmin.json()) as { secretPage: { title: string } };
    expect(restrictedBody.secretPage.title).toBe("Classified");

    // Global with custom access.read forces private, no-store even when published.
    await handler(
      req("/api/xenon/globals/admin-only", {
        method: "PATCH",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ flag: true }),
      }),
    );
    const privGet = await handler(req("/api/xenon/globals/admin-only", { headers: adminAuth }));
    expect(privGet.status).toBe(200);
    expect(privGet.headers.get("cache-control")).toBe("private, no-store");
    expect((await handler(req("/api/xenon/globals/admin-only", { headers: editorAuth }))).status).toBe(403);

    // Unpublish over REST hides live GET.
    const unpubRes = await handler(req("/api/xenon/globals/site-settings/unpublish", { method: "POST", headers: editorAuth }));
    expect(unpubRes.status).toBe(200);
    expect((await unpubRes.json() as { status: string }).status).toBe("draft");
    expect((await handler(req("/api/xenon/globals/site-settings"))).status).toBe(404);
  });
});

describe("HTTP admin transport, presence & UI rendering for globals", () => {
  test("admin loader, /_admin/action, CSRF Origin check, and presence work end-to-end", async () => {
    const { config, xenon, handler } = makeFixture();

    // Unauthenticated admin request hides globals.
    const unauth = await loadAdminData({ config, xenon, segments: ["setup"], headers: new Headers() });
    expect(unauth.kind).toBe("auth");
    if (unauth.kind === "auth") {
      expect(unauth.shell.globals).toEqual([]);
    }

    // Bootstrap first admin user via /_admin/action.
    const setupRes = await handler(
      req("/api/xenon/_admin/action", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ type: "auth.setup", name: "Admin", email: "admin@example.com", password: "password123" }),
      }),
    );
    expect(setupRes.status).toBe(200);
    const cookie = setupRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

    // Cookie-authenticated PATCH without Origin is rejected by High #5 CSRF guard.
    const badOrigin = await handler(
      req("/api/xenon/globals/site-settings", {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ siteName: "Hacked" }),
      }),
    );
    expect(badOrigin.status).toBe(403);

    // Admin data route for /admin/globals/site-settings returns global-edit with doc: null initially.
    const dataRes = await handler(req("/api/xenon/_admin/data?path=/admin/globals/site-settings", { headers: { cookie } }));
    expect(dataRes.status).toBe(200);
    const routeData = (await dataRes.json()) as { kind: string; global?: { slug: string; label: string }; doc?: unknown; shell?: { globals?: { slug: string }[]; presenceToken?: string } };
    expect(routeData.kind).toBe("global-edit");
    expect(routeData.global?.slug).toBe("site-settings");
    expect(routeData.doc).toBeNull();
    expect(routeData.shell?.globals?.map((g) => g.slug)).toEqual(["site-settings", "footer", "admin-only"]);

    // Extra segment or unknown global -> 404 not-found.
    expect((await handler(req("/api/xenon/_admin/data?path=/admin/globals/unknown", { headers: { cookie } }))).status).toBe(404);
    expect((await handler(req("/api/xenon/_admin/data?path=/admin/globals/site-settings/extra", { headers: { cookie } }))).status).toBe(404);

    // Save + draft + unpublish via /_admin/action.
    const savePub = await handler(
      req("/api/xenon/_admin/action", {
        method: "POST",
        headers: { cookie, "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ type: "global.save", slug: "site-settings", data: { siteName: "Admin Site" }, draft: false }),
      }),
    );
    expect(savePub.status).toBe(200);
    const savedPayload = (await savePub.json()) as { ok: true; data: { status: string; hasUnpublishedChanges: boolean; updatedAt: string; data: { siteName: string } } };
    expect(savedPayload.ok).toBe(true);
    expect(savedPayload.data.status).toBe("published");
    expect(savedPayload.data.hasUnpublishedChanges).toBe(false);
    expect(savedPayload.data.data.siteName).toBe("Admin Site");

    // Draft edit after publish marks hasUnpublishedChanges = true.
    const saveDraft = await handler(
      req("/api/xenon/_admin/action", {
        method: "POST",
        headers: { cookie, "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          type: "global.save",
          slug: "site-settings",
          data: { siteName: "Admin Site v2" },
          draft: true,
          expectedUpdatedAt: savedPayload.data.updatedAt,
        }),
      }),
    );
    expect(saveDraft.status).toBe(200);
    const draftPayload = (await saveDraft.json()) as { ok: true; data: { status: string; hasUnpublishedChanges: boolean } };
    expect(draftPayload.data.status).toBe("published");
    expect(draftPayload.data.hasUnpublishedChanges).toBe(true);

    // Presence accepts global locations and rejects unknown globals.
    const presenceToken = routeData.shell!.presenceToken!;
    const presOk = await handler(
      req("/api/xenon/_presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: presenceToken,
          tab: "tab-1",
          location: { collection: GLOBALS_COLLECTION, id: "site-settings", title: "Site Settings" },
          intent: "edit",
        }),
      }),
    );
    expect(presOk.status).toBe(200);
    const presSnap = (await presOk.json()) as { you: { editing: boolean } };
    expect(presSnap.you.editing).toBe(true);

    // Editor user does not see admin-only global in sidebar and gets access-denied on direct route.
    await handler(
      req("/api/xenon/_admin/action", {
        method: "POST",
        headers: { cookie, "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ type: "users.create", name: "Ed", email: "ed@example.com", password: "password123", role: "editor" }),
      }),
    );
    const edLogin = await handler(
      req("/api/xenon/_admin/action", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ type: "auth.login", email: "ed@example.com", password: "password123" }),
      }),
    );
    const edCookie = edLogin.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const edDenied = await loadAdminData({
      config,
      xenon,
      segments: ["globals", "admin-only"],
      headers: new Headers({ cookie: edCookie }),
    });
    expect(edDenied.kind).toBe("access-denied");
    if (edDenied.kind === "access-denied") {
      expect(edDenied.shell.globals?.map((g) => g.slug)).toEqual(["site-settings", "footer"]);
    }
  });

  test("AdminRoot sidebar renders direct global entries and GlobalEditor renders form without delete", () => {
    const { pages, siteSettings, footer } = makeFixture();
    const clientCollections = [toClientCollection(pages)];
    const clientGlobals = [toClientGlobal(siteSettings), toClientGlobal(footer)];
    const mockRouter: AdminRouter = {
      Link: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
      usePathname: () => "/admin/globals/site-settings",
      push() {},
      replace() {},
      refresh() {},
    };

    const html = renderToStaticMarkup(
      <AdminRoot
        theme="light"
        basePath="/admin"
        apiPath="/api/xenon"
        router={mockRouter}
        collections={clientCollections}
        globals={clientGlobals}
        user={{ id: "u1", email: "admin@example.com", name: "Admin", role: "admin" }}
      >
        <GlobalEditor global={clientGlobals[0]!} doc={null} />
      </AdminRoot>,
    );

    expect(html).toContain('href="/admin/globals/site-settings"');
    expect(html).toContain('href="/admin/globals/footer"');
    expect(html).toContain("Globals");
    expect(html).toContain("Navigation");
    expect(html).toContain("Site Settings");
    expect(html).toContain("Global site identity and metadata");
    expect(html).toContain("site-settings");
    expect(html).not.toContain("Delete permanently");
  });
});
