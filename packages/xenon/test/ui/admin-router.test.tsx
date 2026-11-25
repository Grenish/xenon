import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { memoryAdapter } from "../../src/adapters/memory";
import { createHandler } from "../../src/http/handler";
import { defineCollection, defineConfig, text } from "../../src/index";
import { createXenon } from "../../src/server/xenon";
import {
  AdminLink,
  AdminRouterProvider,
  createHistoryRouter,
  createHttpAdminAction,
  fetchAdminData,
  useAdminPathname,
  useAdminRouter,
  type AdminRouter,
} from "../../src/ui/client";

describe("AdminRouter and framework decoupling", () => {
  test("default History router renders SSR links with initialPathname without Next.js", () => {
    const router = createHistoryRouter({ initialPathname: "/admin/collections/posts" });

    function Probe() {
      const pathname = useAdminPathname();
      const active = useAdminRouter();
      return (
        <div>
          <span data-probe="path">{pathname}</span>
          <span data-probe="same">{String(active === router)}</span>
          <AdminLink href="/admin/settings" className="nav">Settings</AdminLink>
        </div>
      );
    }

    const html = renderToStaticMarkup(
      <AdminRouterProvider router={router}>
        <Probe />
      </AdminRouterProvider>,
    );
    expect(html).toContain('<span data-probe="path">/admin/collections/posts</span>');
    expect(html).toContain('<span data-probe="same">true</span>');
    expect(html).toContain('<a href="/admin/settings" class="nav">Settings</a>');
  });

  test("custom AdminRouterProvider overrides Link, pathname, push, replace, and refresh", () => {
    const calls: string[] = [];
    const custom: AdminRouter = {
      Link: ({ href, children, ...rest }) => <a data-custom="1" href={href} {...rest}>{children}</a>,
      usePathname: () => "/custom/path",
      push: (href) => calls.push(`push:${href}`),
      replace: (href) => calls.push(`replace:${href}`),
      refresh: () => calls.push("refresh"),
    };

    function Probe() {
      const pathname = useAdminPathname();
      const r = useAdminRouter();
      r.push("/a");
      r.replace("/b");
      r.refresh();
      return (
        <div>
          <span>{pathname}</span>
          <AdminLink href="/c">Go</AdminLink>
        </div>
      );
    }

    const html = renderToStaticMarkup(
      <AdminRouterProvider router={custom}>
        <Probe />
      </AdminRouterProvider>,
    );
    expect(html).toContain("<span>/custom/path</span>");
    expect(html).toContain('<a data-custom="1" href="/c">Go</a>');
    expect(calls).toEqual(["push:/a", "replace:/b", "refresh"]);
  });

  test("createHistoryRouter updates history, scrolls, and invokes onRefresh", () => {
    const origWindow = globalThis.window;
    const pushed: string[] = [];
    const replaced: string[] = [];
    let scrolled = 0;
    let refreshed = 0;
    const loc = { pathname: "/admin", href: "http://localhost:3000/admin", origin: "http://localhost:3000" };

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: loc,
        history: {
          pushState: (_state: unknown, _title: string, url: string) => {
            pushed.push(url);
            loc.pathname = url.split("?")[0]!;
            loc.href = `http://localhost:3000${url}`;
          },
          replaceState: (_state: unknown, _title: string, url: string) => {
            replaced.push(url);
            loc.pathname = url.split("?")[0]!;
            loc.href = `http://localhost:3000${url}`;
          },
        },
        scrollTo: () => { scrolled++; },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });

    try {
      const router = createHistoryRouter({ onRefresh: () => { refreshed++; } });
      router.push("/admin/collections/posts");
      router.replace("/admin/collections/posts?page=2", { scroll: false });
      router.refresh();
      expect(pushed).toEqual(["/admin/collections/posts"]);
      expect(replaced).toEqual(["/admin/collections/posts?page=2"]);
      expect(scrolled).toBe(1);
      expect(refreshed).toBe(1);
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: origWindow });
    }
  });

  describe("HTTP client transport helpers (createHttpAdminAction & fetchAdminData)", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("round-trips setup, doc.save, and fetchAdminData against createHandler", async () => {
      const config = defineConfig({
        collections: [defineCollection({ slug: "posts", slugFrom: "title", fields: { title: text({ required: true }) } })],
        db: memoryAdapter(),
        auth: {
          secret: "client-transport-test-secret-0123456789-abcdefghijklmnop",
          baseURL: "http://localhost:3000",
        },
      });
      const handler = createHandler(config, { xenon: createXenon(config) });
      let cookieJar = "";

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? `http://localhost:3000${input}` : String(input);
        const headers = new Headers(init?.headers);
        headers.set("origin", "http://localhost:3000");
        if (cookieJar) headers.set("cookie", cookieJar);
        const res = await handler(new Request(url, { method: init?.method ?? "GET", headers, body: init?.body }));
        const setCookies = res.headers.getSetCookie();
        if (setCookies.length) cookieJar = setCookies.map((c) => c.split(";")[0]).join("; ");
        return res;
      }) as typeof fetch;

      const action = createHttpAdminAction("/api/xenon");
      const setup = await action({ type: "auth.setup", name: "Admin", email: "admin@example.com", password: "password123" });
      expect(setup).toEqual({ ok: true, data: null });

      const saved = await action({ type: "doc.save", collection: "posts", data: { title: "Transport Post" }, draft: false });
      expect(saved.ok).toBe(true);

      const listData = await fetchAdminData("/api/xenon", "/admin/collections/posts", "q=Transport");
      expect(listData.kind).toBe("collection-list");
      if (listData.kind === "collection-list") {
        expect(listData.totalDocs).toBe(1);
        expect(listData.rows[0]?.title).toBe("Transport Post");
      }
    });
  });

  test("built dist/client.js, dist/http.js, and dist/html.js are decoupled from Next.js (and http/html from React)", async () => {
    const distDir = join(import.meta.dir, "../../dist");
    const [clientJs, httpJs, htmlJs, nextClientJs] = await Promise.all([
      readFile(join(distDir, "client.js"), "utf8"),
      readFile(join(distDir, "http.js"), "utf8"),
      readFile(join(distDir, "html.js"), "utf8"),
      readFile(join(distDir, "next-client.js"), "utf8"),
    ]);

    expect(clientJs.startsWith('"use client";')).toBe(true);
    expect(nextClientJs.startsWith('"use client";')).toBe(true);
    expect(clientJs).not.toMatch(/from\s+["']next\//);
    expect(httpJs).not.toMatch(/from\s+["']next\//);
    expect(htmlJs).not.toMatch(/from\s+["']next\//);
    expect(httpJs).not.toMatch(/from\s+["']react["'/]/);
    expect(htmlJs).not.toMatch(/from\s+["']react["'/]/);
  });
});
