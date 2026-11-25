"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PresenceLocation, PresencePeer, PresenceSnapshot, PresenceUser } from "../../adapters/types";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import { useAdminPathname } from "../shared/router";
import { initials } from "./format";
import { useAdminRuntime } from "./runtime";

/*
 * Client side of presence. One heartbeat per browser tab:
 *  - visible tab on a document: every 8 s; elsewhere: every 20 s
 *  - hidden tab: every 30 s while it holds a document's lock (so the lock survives a quick
 *    switch to another window), otherwise paused until the tab is visible again
 *  - an immediate beat when the tab moves, asks for or takes over a lock, or saves a new version
 *  - a `leave` beacon when the page is closed
 * The heartbeat carries a signed token, never cookies, and the server keeps presence in memory.
 */

const VISIBLE_DOC_MS = 8_000;
const VISIBLE_MS = 20_000;
const HIDDEN_EDITING_MS = 30_000;
const RENEW_BEFORE_MS = 5 * 60_000;

/* ---------------------------------------------------------------------------- module state */

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** What the open document editor wants: its identity, title, version and whether it edits. */
interface DocRegistration {
  owner: number;
  collection: string;
  id: string;
  title: string;
  version: string | null;
  intent: "view" | "edit" | "takeover";
}

interface LiveState {
  snapshot: PresenceSnapshot | null;
  /** `collection/id` (or `collection`, or "") the snapshot was taken at. */
  at: string;
  status: "connecting" | "live" | "off";
}

const docStore = createStore<DocRegistration | null>(null);
const liveStore = createStore<LiveState>({ snapshot: null, at: "", status: "connecting" });
const kick = { current: null as null | (() => void) };
export interface PresenceSession {
  apiPath: string;
  getToken: () => string | null;
  stop: () => void;
}

let activeSession: PresenceSession | null = null;
let tabId: string | null = null;
const tab = () => (tabId ??= typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const locationKey = (l: PresenceLocation | null) => (l ? (l.id ? `${l.collection}/${l.id}` : l.collection) : "");

/** Registers the active heartbeat session so `leavePresence()` can release it immediately on sign-out. */
export function registerPresenceSession(session: PresenceSession): () => void {
  activeSession = session;
  return () => {
    if (activeSession === session) activeSession = null;
  };
}

/** Returns the current client presence tab id (used by heartbeat and leave requests). */
export function presenceTabId(): string {
  return tab();
}

/**
 * Immediately clears this tab's presence entry and releases any edit lock (called on sign-out).
 * Stops future heartbeats, clears client presence state, and posts `{ leave: true }` with `keepalive`.
 */
export async function leavePresence(): Promise<void> {
  const session = activeSession;
  activeSession = null;
  kick.current = null;
  docStore.set(null);
  liveStore.set({ snapshot: null, at: "", status: "off" });
  if (!session) return;
  const token = session.getToken();
  session.stop();
  if (!token) return;
  const url = `${session.apiPath}/_presence`;
  const payload = JSON.stringify({ token, tab: tab(), leave: true });
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
    });
  } catch {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" }));
    }
  }
}

function tokenExpiry(token: string | null): number {
  try {
    const body = token?.split(".")[0];
    if (!body) return 0;
    return (JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number }).exp ?? 0;
  } catch {
    return 0;
  }
}

/* ---------------------------------------------------------------------------- heartbeat */

/** Mounted once by the signed-in shell. Renders nothing. */
export function PresenceHeartbeat({ token }: { token: string | null }) {
  const { apiPath, run } = useAdminRuntime();
  const { basePath } = useAdmin();
  const pathname = useAdminPathname();
  const doc = useSyncExternalStore(docStore.subscribe, docStore.get, () => null);
  const tokenRef = useRef(token);
  if (token && tokenExpiry(token) > tokenExpiry(tokenRef.current)) tokenRef.current = token;

  // Where this tab is, from the route; the editor adds the title and version.
  const location = useMemo<PresenceLocation | null>(() => {
    const prefix = `${basePath}/collections/`;
    if (!pathname.startsWith(prefix)) return null;
    const [collection, id] = pathname.slice(prefix.length).split("/");
    if (!collection) return null;
    if (!id || id === "new") return { collection };
    return { collection, id, title: doc && doc.collection === collection && doc.id === id ? doc.title.slice(0, 160) : undefined };
  }, [pathname, basePath, doc]);
  const registered = doc && location?.id && doc.collection === location.collection && doc.id === location.id ? doc : null;
  const intent = registered?.intent ?? "view";
  const version = registered?.version ?? undefined;

  const state = useRef({ location, intent, version });
  state.current = { location, intent, version };

  useEffect(() => {
    if (!tokenRef.current) {
      liveStore.set({ snapshot: null, at: "", status: "off" });
      return;
    }
    const url = `${apiPath}/_presence`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inflight = false;
    let again = false;
    let last = 0;

    async function renew() {
      const result = await run<string>({ type: "presence.token" });
      if (result.ok) tokenRef.current = result.data;
      return result.ok;
    }
    const post = (body: unknown) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "omit" });

    function schedule() {
      clearTimeout(timer);
      if (stopped) return;
      const hidden = document.visibilityState === "hidden";
      const holding = liveStore.get().snapshot?.you.editing ?? false;
      if (hidden && !holding) return; // paused; resumes on visibilitychange
      timer = setTimeout(beat, hidden ? HIDDEN_EDITING_MS : state.current.location?.id ? VISIBLE_DOC_MS : VISIBLE_MS);
    }

    async function beat() {
      if (stopped) return;
      if (inflight) { again = true; return; }
      inflight = true;
      last = Date.now();
      clearTimeout(timer);
      const sent = state.current;
      try {
        if (tokenExpiry(tokenRef.current) - Date.now() < RENEW_BEFORE_MS) await renew();
        const body = () => ({ token: tokenRef.current, tab: tab(), location: sent.location, intent: sent.intent, version: sent.version });
        let res = await post(body());
        if (res.status === 401 && (await renew())) res = await post(body());
        if (res.status === 404) {
          stopped = true;
          liveStore.set({ snapshot: null, at: "", status: "off" });
          return;
        }
        if (res.ok && !stopped) {
          liveStore.set({ snapshot: (await res.json()) as PresenceSnapshot, at: locationKey(sent.location), status: "live" });
          // A takeover is a one-off request; afterwards the tab simply keeps editing.
          const reg = docStore.get();
          if (sent.intent === "takeover" && reg?.intent === "takeover") docStore.set({ ...reg, intent: "edit" });
        }
      } catch {
        // Offline or server restarting: keep the last snapshot and try again on the next tick.
      } finally {
        inflight = false;
        if (!stopped && again) { again = false; void beat(); } else schedule();
      }
    }

    const stopSession = () => {
      stopped = true;
      clearTimeout(timer);
      tokenRef.current = null;
    };
    const unregisterSession = registerPresenceSession({ apiPath, getToken: () => tokenRef.current, stop: stopSession });

    // Coming back to the tab refreshes presence, but flapping visibility never causes a burst.
    const onVisibility = () => (document.visibilityState === "visible" && Date.now() - last > 2_000 ? void beat() : schedule());
    const onPageHide = () => {
      if (stopped || !tokenRef.current) return;
      const payload = JSON.stringify({ token: tokenRef.current, tab: tab(), leave: true });
      navigator.sendBeacon?.(url, new Blob([payload], { type: "text/plain" }));
    };
    kick.current = () => void beat();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onVisibility);
    void beat();
    return () => {
      stopped = true;
      clearTimeout(timer);
      unregisterSession();
      if (kick.current) kick.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, [apiPath, run]);

  // Beat right away when the tab moves, changes intent or has a new version (not on title keystrokes).
  const trigger = `${locationKey(location)}|${intent}|${version ?? ""}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    kick.current?.();
  }, [trigger]);

  return null;
}

/* ---------------------------------------------------------------------------- hooks */

export function usePresence(): LiveState {
  return useSyncExternalStore(liveStore.subscribe, liveStore.get, liveStore.get);
}

export function peersAt(peers: PresencePeer[], collection: string, id?: string | null): PresencePeer[] {
  return peers.filter((p) => p.location?.collection === collection && (id === undefined || (p.location?.id ?? null) === (id ?? null)));
}

export type DocLockMode = "editing" | "locked" | "taken";

export interface DocPresence {
  /** `editing`: this tab may edit. `locked`: someone else holds the lock. `taken`: it was taken from this tab. */
  mode: DocLockMode;
  holder: PresencePeer | null;
  takenOverBy: { user: PresenceUser; at: number } | null;
  /** Everyone else on this document, the lock holder first. */
  peers: PresencePeer[];
  takeover(): void;
}

let owners = 0;

/**
 * The editor's presence: registers the open document (title, version, wish to edit) with the
 * heartbeat and reports the soft-lock state. Fails open: without a live connection you can edit
 * (the save-conflict check still protects against overwriting someone else).
 */
export function useDocPresence({ collection, id, title, version, edit }: { collection: string; id: string | null; title: string; version: string | null; edit: boolean }): DocPresence {
  const owner = useRef(0);
  if (!owner.current) owner.current = ++owners;
  const live = usePresence();

  useLayoutEffect(() => {
    if (!id) return;
    const current = docStore.get();
    const intent = current?.owner === owner.current && current.intent === "takeover" ? "takeover" : edit ? "edit" : "view";
    docStore.set({ owner: owner.current, collection, id, title, version, intent });
  }, [collection, id, title, version, edit]);
  useEffect(() => () => { if (docStore.get()?.owner === owner.current) docStore.set(null); }, []);

  const takeover = useCallback(() => {
    const current = docStore.get();
    if (current?.owner === owner.current) docStore.set({ ...current, intent: "takeover" });
  }, []);

  const fresh = live.status === "live" && !!id && live.at === `${collection}/${id}` ? live.snapshot : null;
  const here = fresh ? peersAt(fresh.peers, collection, id) : [];
  const holder = here.find((p) => p.editing) ?? null;
  const takenOverBy = fresh?.you.takenOverBy ?? null;
  const mode: DocLockMode = !fresh || !edit ? "editing" : takenOverBy ? "taken" : fresh.you.editing || !holder ? "editing" : "locked";
  const peers = holder ? [holder, ...here.filter((p) => p !== holder)] : here;
  return { mode, holder, takenOverBy, peers, takeover };
}

/* ---------------------------------------------------------------------------- avatars */

/** Stable pale identity tint per person (identity, not data: it never appears in charts). */
function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 12) * 30;
}

export function displayName(user: PresenceUser): string {
  return user.name?.trim() || user.email;
}

export function PersonAvatar({ user, editing, size = "md", className }: { user: PresenceUser; editing?: boolean; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      title={editing ? `${displayName(user)} is editing` : displayName(user)}
      style={{ ["--xe-h" as string]: hue(user.id) }}
      className={cn(
        "xe:inline-grid xe:shrink-0 xe:place-items-center xe:rounded-full xe:font-semibold xe:ring-2 xe:ring-background",
        "xe:bg-[oklch(0.92_0.05_var(--xe-h))] xe:text-[oklch(0.38_0.09_var(--xe-h))] xe:dark:bg-[oklch(0.34_0.06_var(--xe-h))] xe:dark:text-[oklch(0.9_0.05_var(--xe-h))]",
        size === "sm" ? "xe:size-5 xe:text-[9.5px]" : "xe:size-6 xe:text-[10.5px]",
        editing && "xe:outline-2 xe:outline-offset-1 xe:outline-brand xe:outline",
        className,
      )}
    >
      {initials(user.name, user.email)}
    </span>
  );
}

/** Overlapping avatars, one per person (several tabs of one person count once). */
export function AvatarStack({ peers, max = 4, size = "md", ringClass }: { peers: PresencePeer[]; max?: number; size?: "sm" | "md"; ringClass?: string }) {
  const people = dedupe(peers);
  if (!people.length) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="xe:flex xe:items-center xe:-space-x-1.5">
      {shown.map((p) => <PersonAvatar key={p.user.id} user={p.user} editing={p.editing} size={size} className={ringClass} />)}
      {rest > 0 ? (
        <span className={cn("xe:inline-grid xe:place-items-center xe:rounded-full xe:bg-muted xe:font-medium xe:text-muted-foreground xe:ring-2 xe:ring-background", size === "sm" ? "xe:size-5 xe:text-[9.5px]" : "xe:size-6 xe:text-[10.5px]", ringClass)}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/** One entry per person; an editing tab wins over a viewing one. */
export function dedupe(peers: PresencePeer[]): PresencePeer[] {
  const byUser = new Map<string, PresencePeer>();
  for (const p of peers) {
    const seen = byUser.get(p.user.id);
    if (!seen || (p.editing && !seen.editing)) byUser.set(p.user.id, p);
  }
  return [...byUser.values()];
}

/** Others on one document (list rows, dashboard rows). Renders nothing when nobody is there. */
export function DocPeers({ collection, id }: { collection: string; id: string }) {
  const { user } = useAdmin();
  const { snapshot } = usePresence();
  const peers = snapshot ? peersAt(snapshot.peers, collection, id).filter((p) => p.user.id !== user.id) : [];
  if (!peers.length) return null;
  const editor = peers.find((p) => p.editing);
  return (
    <span className="xe:inline-flex xe:items-center xe:gap-1.5 xe:align-middle" aria-label={editor ? `${displayName(editor.user)} is editing` : `${dedupe(peers).map((p) => displayName(p.user)).join(", ")} viewing`}>
      <AvatarStack peers={peers} max={3} size="sm" />
      {editor ? <span className="xe:text-xs xe:text-muted-foreground">editing</span> : null}
    </span>
  );
}
