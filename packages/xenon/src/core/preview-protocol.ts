/**
 * Framework-agnostic Live Preview `postMessage` protocol (#14).
 * Zero React or Node dependencies — usable from any browser host (Next.js, Astro, TanStack Start, SPA).
 */

export const XENON_PREVIEW_CHANNEL = "xenon:live-preview";

export interface LivePreviewUpdateMessage {
  channel: typeof XENON_PREVIEW_CHANNEL;
  type: "xenon:preview:update";
  kind: "collection" | "global";
  slug: string;
  id?: string;
  /** Unsaved working document (system metadata + live form fields). */
  data: Record<string, unknown>;
  updatedAt?: string;
}

export interface LivePreviewReadyMessage {
  channel: typeof XENON_PREVIEW_CHANNEL;
  type: "xenon:preview:ready";
  kind?: "collection" | "global";
  slug?: string;
  id?: string;
}

export type LivePreviewMessage = LivePreviewUpdateMessage | LivePreviewReadyMessage;

export interface SubscribeLivePreviewOptions<T = Record<string, unknown>> {
  /**
   * Origin of the Xenon Admin hosting the preview iframe (e.g. `"https://cms.example.com"`).
   * Defaults to `window.location.origin` (same-origin admin). Messages from any other origin are ignored.
   */
  serverURL?: string;
  /** Only receive updates for this collection slug. */
  collection?: string;
  /** Only receive updates for this global slug. */
  global?: string;
  /** Only receive updates for this document id (collections). */
  id?: string;
  /** Invoked whenever the admin posts updated live form state. */
  onData: (data: T, message: LivePreviewUpdateMessage) => void;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merges incoming raw form state onto an existing (possibly populated) document so live edits
 * update scalar/nested values without clobbering populated relation/media objects whose id didn't change.
 */
export function mergeLivePreviewData<T>(previous: T, incoming: Record<string, unknown>): T {
  if (!isPlainRecord(previous)) return incoming as T;
  const next: Record<string, unknown> = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    const prev = next[key];
    // Preserve populated single relation/media object when the raw form still holds the same id.
    if (typeof value === "string" && isPlainRecord(prev) && typeof prev.id === "string" && prev.id === value) {
      continue;
    }
    // Preserve populated hasMany relation/media objects when the raw form holds the exact same id sequence.
    if (
      Array.isArray(value) &&
      Array.isArray(prev) &&
      value.every((v) => typeof v === "string") &&
      prev.length === value.length &&
      prev.every((item, i) => isPlainRecord(item) && typeof item.id === "string" && item.id === value[i])
    ) {
      continue;
    }
    next[key] = value;
  }
  return next as T;
}

/**
 * Subscribes a previewed page to unsaved editor updates posted by the Xenon Admin split-pane iframe.
 * Sends a `xenon:preview:ready` handshake to `window.parent` and returns an unsubscribe cleanup function.
 */
export function subscribeLivePreview<T = Record<string, unknown>>(
  options: SubscribeLivePreviewOptions<T>,
): () => void {
  if (typeof window === "undefined") return () => {};

  let allowedOrigin: string;
  try {
    allowedOrigin = options.serverURL
      ? new URL(options.serverURL, window.location.origin).origin
      : window.location.origin;
  } catch {
    return () => {};
  }

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== allowedOrigin) return;
    const raw = event.data;
    if (!isPlainRecord(raw)) return;
    if (raw.channel !== XENON_PREVIEW_CHANNEL || raw.type !== "xenon:preview:update") return;
    if ((raw.kind !== "collection" && raw.kind !== "global") || typeof raw.slug !== "string") return;
    if (!isPlainRecord(raw.data)) return;

    if (options.collection !== undefined && (raw.kind !== "collection" || raw.slug !== options.collection)) return;
    if (options.global !== undefined && (raw.kind !== "global" || raw.slug !== options.global)) return;
    if (options.id !== undefined && raw.id !== options.id) return;

    options.onData(raw.data as T, raw as unknown as LivePreviewUpdateMessage);
  };

  window.addEventListener("message", onMessage);

  if (window.parent && window.parent !== window) {
    const ready: LivePreviewReadyMessage = {
      channel: XENON_PREVIEW_CHANNEL,
      type: "xenon:preview:ready",
      ...(options.collection ? { kind: "collection", slug: options.collection } : {}),
      ...(options.global ? { kind: "global", slug: options.global } : {}),
      ...(options.id ? { id: options.id } : {}),
    };
    try {
      window.parent.postMessage(ready, allowedOrigin);
    } catch {
      // Parent origin mismatch or sandboxed frame — listener still receives updates if allowed.
    }
  }

  return () => {
    window.removeEventListener("message", onMessage);
  };
}
