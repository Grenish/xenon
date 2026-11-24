import { afterEach, describe, expect, test } from "bun:test";
import { memoryAdapter } from "../../src/adapters/memory";
import { defineCollection, defineConfig, text } from "../../src/index";
import { createApiHandler } from "../../src/next/api-handler";
import { memoryPresence, signPresenceToken } from "../../src/server/presence";
import { guardNavigation, hasDirtyBlocker, registerDirtyBlocker } from "../../src/ui/admin/dirty-guard";
import { leavePresence, presenceTabId, registerPresenceSession } from "../../src/ui/admin/presence";

const SECRET = "presence-leave-test-secret-0123456789abcdef";

describe("Medium #22: unsaved-changes dirty navigation guard", () => {
  test("runs navigation immediately when clean and blocks when an editor registers a dirty guard", () => {
    expect(hasDirtyBlocker()).toBe(false);
    let navigated: boolean | null = null;
    expect(guardNavigation((replace) => { navigated = replace; })).toBe(true);
    expect(navigated as boolean | null).toBe(false);

    let pendingConfirm: ((replace: boolean) => void) | null = null;
    const unregister = registerDirtyBlocker({
      confirm: (proceed) => { pendingConfirm = proceed; },
    });

    try {
      expect(hasDirtyBlocker()).toBe(true);
      let blockedNav: boolean | null = null;
      expect(guardNavigation((replace) => { blockedNav = replace; })).toBe(false);
      expect(blockedNav).toBeNull();
      expect(pendingConfirm).not.toBeNull();

      // Confirming discard runs the deferred navigation with replace=true (replacing the Back sentinel).
      pendingConfirm!(true);
      expect(blockedNav as boolean | null).toBe(true);
    } finally {
      unregister();
    }

    expect(hasDirtyBlocker()).toBe(false);
  });

  test("stale unregister does not clear a newer active blocker", () => {
    const first = registerDirtyBlocker({ confirm: () => {} });
    const second = registerDirtyBlocker({ confirm: (proceed) => proceed(true) });
    first();
    expect(hasDirtyBlocker()).toBe(true);
    let ran = false;
    expect(guardNavigation(() => { ran = true; })).toBe(false);
    expect(ran).toBe(true);
    second();
    expect(hasDirtyBlocker()).toBe(false);
  });
});

describe("Medium #21: leavePresence immediately releases edit locks on sign-out", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("posts leave with keepalive, stops the session, and frees the edit lock immediately for peers", async () => {
    const store = memoryPresence();
    const cfg = defineConfig({
      collections: [defineCollection({ slug: "posts", fields: { title: text({ required: true }) } })],
      db: memoryAdapter(),
      presence: store,
      auth: { secret: SECRET, baseURL: "http://localhost:3000" },
    });
    const { POST } = createApiHandler(cfg);
    const aliceToken = await signPresenceToken(SECRET, { id: "alice", name: "Alice", email: "alice@example.com" });
    const bobToken = await signPresenceToken(SECRET, { id: "bob", name: "Bob", email: "bob@example.com" });
    const aliceTab = presenceTabId();

    const postPresence = (body: Record<string, unknown>) =>
      POST(
        new Request("http://localhost:3000/api/xenon/_presence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ slug: ["_presence"] }) },
      );

    // Alice opens and locks posts/doc-1; Bob is locked out.
    const aliceBeat = await (await postPresence({
      token: aliceToken, tab: aliceTab, location: { collection: "posts", id: "doc-1", title: "Draft" }, intent: "edit",
    })).json() as { you: { editing: boolean } };
    expect(aliceBeat.you.editing).toBe(true);

    const bobLocked = await (await postPresence({
      token: bobToken, tab: "bob-tab", location: { collection: "posts", id: "doc-1", title: "Draft" }, intent: "edit",
    })).json() as { you: { editing: boolean }; peers: unknown[] };
    expect(bobLocked.you.editing).toBe(false);
    expect(bobLocked.peers.length).toBe(1);

    // Wire Alice's active presence session and intercept fetch → real POST /_presence handler.
    let stopped = false;
    let keepaliveSeen: boolean | undefined;
    let currentToken: string | null = aliceToken;
    registerPresenceSession({
      apiPath: "/api/xenon",
      getToken: () => currentToken,
      stop: () => { stopped = true; currentToken = null; },
    });

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      keepaliveSeen = init?.keepalive;
      const url = typeof input === "string" ? `http://localhost:3000${input}` : String(input);
      return POST(
        new Request(url, { method: init?.method ?? "POST", headers: init?.headers, body: init?.body }),
        { params: Promise.resolve({ slug: ["_presence"] }) },
      );
    }) as typeof fetch;

    await leavePresence();
    expect(stopped).toBe(true);
    expect(currentToken).toBeNull();
    expect(keepaliveSeen).toBe(true);

    // Bob's very next heartbeat acquires the lock immediately and sees zero peers.
    const bobAfter = await (await postPresence({
      token: bobToken, tab: "bob-tab", location: { collection: "posts", id: "doc-1", title: "Draft" }, intent: "edit",
    })).json() as { you: { editing: boolean }; peers: unknown[] };
    expect(bobAfter.you.editing).toBe(true);
    expect(bobAfter.peers.length).toBe(0);
  });

  test("falls back to sendBeacon if fetch fails during navigation", async () => {
    let beaconUrl: string | null = null;
    let beaconBody = "";
    const originalNav = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        sendBeacon: (url: string, data: Blob) => {
          beaconUrl = url;
          void data.text().then((text) => { beaconBody = text; });
          return true;
        },
      },
    });
    globalThis.fetch = (async () => { throw new Error("network aborted"); }) as unknown as typeof fetch;

    registerPresenceSession({
      apiPath: "/api/xenon",
      getToken: () => "tok.sig",
      stop: () => {},
    });

    try {
      await leavePresence();
      await Promise.resolve();
      expect(beaconUrl as string | null).toBe("/api/xenon/_presence");
      expect(beaconBody).toContain('"leave":true');
    } finally {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNav });
    }
  });
});
