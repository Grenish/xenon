import type { PresenceBeat, PresencePeer, PresenceSnapshot, PresenceStore, PresenceUser } from "../adapters/types";

/*
 * Presence and soft locks for the admin.
 *
 * Cost model: nothing here touches the database. Tabs authenticate with a short-lived HMAC token
 * minted when the admin page renders (so a heartbeat never needs a session lookup), and presence is
 * kept in memory by default. A heartbeat is one small JSON request every few seconds while a tab is
 * visible; hidden tabs slow down or stop.
 */

/** A tab that hasn't beaten for this long is gone (and its lock is released). */
export const PRESENCE_TTL_MS = 90_000;
/** Presence tokens live this long; the admin renews them before they expire. */
export const PRESENCE_TOKEN_TTL_MS = 60 * 60 * 1000;

interface Entry extends PresencePeer {
  seenAt: number;
  takenOverBy: PresenceSnapshot["you"]["takenOverBy"];
}

const docKey = (l: PresenceBeat["location"]) => (l?.id ? `${l.collection}/${l.id}` : null);
const sameLocation = (a: PresenceBeat["location"], b: PresenceBeat["location"]) =>
  (a?.collection ?? null) === (b?.collection ?? null) && (a?.id ?? null) === (b?.id ?? null);

/**
 * In-memory presence for one server process. Every beat is applied synchronously, so lock
 * resolution is atomic within the process. Across several instances each one sees only its own
 * tabs: plug a shared `PresenceStore` in for that.
 */
export interface MemoryPresenceStore extends PresenceStore {
  beat(beat: PresenceBeat): PresenceSnapshot;
  leave(userId: string, tab: string): void;
}

export function memoryPresence(options: { ttlMs?: number; now?: () => number } = {}): MemoryPresenceStore {
  const ttl = options.ttlMs ?? PRESENCE_TTL_MS;
  const clock = options.now ?? Date.now;
  // Keyed by user + tab so one user can never touch another user's entry.
  const entries = new Map<string, Entry>();
  const key = (userId: string, tab: string) => `${userId}\u0000${tab}`;

  function prune(now: number) {
    for (const [k, e] of entries) if (now - e.seenAt > ttl) entries.delete(k);
  }

  return {
    name: "memory",
    beat(beat) {
      const now = clock();
      prune(now);
      const k = key(beat.user.id, beat.tab);
      const previous = entries.get(k);
      const moved = !previous || !sameLocation(previous.location, beat.location);
      const entry: Entry = {
        tab: beat.tab,
        user: beat.user,
        location: beat.location,
        editing: moved ? false : previous.editing,
        version: beat.version ?? (moved ? null : previous.version),
        since: moved ? now : previous.since,
        seenAt: now,
        takenOverBy: moved ? null : previous.takenOverBy,
      };
      const doc = docKey(beat.location);
      const others = [...entries.entries()].filter(([other]) => other !== k).map(([, e]) => e);

      if (!doc || beat.intent === "view") {
        entry.editing = false;
        entry.takenOverBy = null;
      } else if (beat.intent === "takeover") {
        for (const e of others) {
          if (e.editing && docKey(e.location) === doc) {
            e.editing = false;
            e.takenOverBy = { user: beat.user, at: now };
          }
        }
        entry.editing = true;
        entry.takenOverBy = null;
        entry.since = now;
      } else if (!entry.takenOverBy) {
        // "edit": the lock goes to the first tab that asks; the others wait (or take over).
        const holder = others.find((e) => e.editing && docKey(e.location) === doc);
        if (!holder) {
          if (!entry.editing) entry.since = now;
          entry.editing = true;
        } else {
          entry.editing = false;
        }
      }

      entries.set(k, entry);
      return {
        you: { editing: entry.editing, takenOverBy: entry.takenOverBy },
        peers: others.map(({ seenAt: _seen, takenOverBy: _taken, ...peer }) => peer),
      };
    },
    leave(userId, tab) {
      entries.delete(key(userId, tab));
    },
  };
}

const GLOBAL_STORE = Symbol.for("xenon.presence.memory");

/** The process-wide default store (survives module duplication across route bundles and HMR). */
export function defaultPresenceStore(): PresenceStore {
  const g = globalThis as typeof globalThis & { [GLOBAL_STORE]?: PresenceStore };
  g[GLOBAL_STORE] ??= memoryPresence();
  return g[GLOBAL_STORE];
}

/* ------------------------------------------------------------------------------------------ tokens */

export interface PresenceTokenPayload extends PresenceUser {
  /** Expiry, ms since epoch. */
  exp: number;
}

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    // Domain-separated from BetterAuth's own use of the secret.
    key = crypto.subtle.importKey("raw", encoder.encode(`xenon-presence:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keys.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function signPresenceToken(secret: string, user: PresenceUser, ttlMs = PRESENCE_TOKEN_TTL_MS, now = Date.now()): Promise<string> {
  const payload: PresenceTokenPayload = { id: user.id, name: user.name, email: user.email, exp: now + ttlMs };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** Returns the user for a valid, unexpired token; `null` otherwise. Constant-time signature check. */
export async function verifyPresenceToken(secret: string, token: unknown, now = Date.now()): Promise<PresenceUser | null> {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(signature), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as Partial<PresenceTokenPayload>;
    if (typeof payload.id !== "string" || typeof payload.email !== "string" || typeof payload.exp !== "number" || payload.exp <= now) return null;
    return { id: payload.id, email: payload.email, name: typeof payload.name === "string" ? payload.name : null };
  } catch {
    return null;
  }
}
