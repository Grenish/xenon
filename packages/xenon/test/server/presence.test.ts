import { describe, expect, test } from "bun:test";
import { memoryPresence, signPresenceToken, verifyPresenceToken } from "../../src/server/presence";

const maya = { id: "u-maya", name: "Maya Okafor", email: "maya@example.com" };
const tom = { id: "u-tom", name: "Tom Lee", email: "tom@example.com" };
const doc = { collection: "posts", id: "p1", title: "Hello" };

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("memoryPresence", () => {
  test("the first tab to ask for a document gets the lock; the next one waits", () => {
    const store = memoryPresence();
    expect(store.beat({ tab: "a", user: maya, location: doc, intent: "edit" })).toMatchObject({ you: { editing: true, takenOverBy: null } });
    const tomView = store.beat({ tab: "b", user: tom, location: doc, intent: "edit" });
    expect(tomView.you.editing).toBe(false);
    expect(tomView.peers).toHaveLength(1);
    expect(tomView.peers[0]).toMatchObject({ user: maya, editing: true, location: doc });
    // Maya keeps the lock on her next beat.
    expect(store.beat({ tab: "a", user: maya, location: doc, intent: "edit" }).you.editing).toBe(true);
  });

  test("takeover moves the lock and tells the previous holder who took it", () => {
    const c = clock();
    const store = memoryPresence({ now: c.now });
    store.beat({ tab: "a", user: maya, location: doc, intent: "edit" });
    store.beat({ tab: "b", user: tom, location: doc, intent: "edit" });
    c.advance(1000);
    expect(store.beat({ tab: "b", user: tom, location: doc, intent: "takeover" }).you.editing).toBe(true);
    const mayaNow = store.beat({ tab: "a", user: maya, location: doc, intent: "edit" });
    expect(mayaNow.you).toEqual({ editing: false, takenOverBy: { user: tom, at: c.now() - 0 } });
    // Asking to edit again does not silently steal it back; viewing clears the notice.
    expect(store.beat({ tab: "a", user: maya, location: doc, intent: "view" }).you).toEqual({ editing: false, takenOverBy: null });
  });

  test("leaving, moving away or going silent releases the lock", () => {
    const c = clock();
    const store = memoryPresence({ now: c.now, ttlMs: 10_000 });
    store.beat({ tab: "a", user: maya, location: doc, intent: "edit" });
    store.leave(maya.id, "a");
    expect(store.beat({ tab: "b", user: tom, location: doc, intent: "edit" }).you.editing).toBe(true);
    store.beat({ tab: "b", user: tom, location: { collection: "posts" }, intent: "view" });
    expect(store.beat({ tab: "a", user: maya, location: doc, intent: "edit" }).you.editing).toBe(true);
    c.advance(10_001);
    expect(store.beat({ tab: "b", user: tom, location: doc, intent: "edit" })).toMatchObject({ you: { editing: true }, peers: [] });
  });

  test("tabs are scoped per user: another user can't overwrite a tab id", () => {
    const store = memoryPresence();
    store.beat({ tab: "same", user: maya, location: doc, intent: "edit" });
    const tomView = store.beat({ tab: "same", user: tom, location: doc, intent: "edit" });
    expect(tomView.you.editing).toBe(false);
    expect(tomView.peers[0]?.user).toEqual(maya);
  });

  test("a peer's version is shared so viewers can notice a newer save", () => {
    const store = memoryPresence();
    store.beat({ tab: "a", user: maya, location: doc, intent: "edit", version: "2026-11-18T10:00:00.000Z" });
    expect(store.beat({ tab: "b", user: tom, location: doc, intent: "view" }).peers[0]?.version).toBe("2026-11-18T10:00:00.000Z");
  });
});

describe("presence tokens", () => {
  const secret = "presence-test-secret-0123456789";
  test("round-trip, expiry and tampering", async () => {
    const token = await signPresenceToken(secret, maya, 60_000, 1_000);
    expect(await verifyPresenceToken(secret, token, 2_000)).toEqual(maya);
    expect(await verifyPresenceToken(secret, token, 61_001)).toBeNull();
    expect(await verifyPresenceToken("another-secret-0123456789", token, 2_000)).toBeNull();
    const [body, signature] = token.split(".");
    const forged = btoa(JSON.stringify({ ...maya, id: "u-admin", exp: 9e15 })).replace(/=+$/, "");
    expect(await verifyPresenceToken(secret, `${forged}.${signature}`, 2_000)).toBeNull();
    expect(await verifyPresenceToken(secret, `${body}`, 2_000)).toBeNull();
    expect(await verifyPresenceToken(secret, 42, 2_000)).toBeNull();
  });
});
