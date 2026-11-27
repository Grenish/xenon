"use client";

import {
  RiCloseLine,
  RiComputerLine,
  RiExternalLinkLine,
  RiRefreshLine,
  RiSmartphoneLine,
  RiTabletLine,
} from "@remixicon/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type LivePreviewUpdateMessage, XENON_PREVIEW_CHANNEL } from "../../core/preview-protocol";
import { Button } from "../components/button";
import { Spinner } from "../components/spinner";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import type { PreviewInfo } from "../shared/services";

export type PreviewViewport = "desktop" | "tablet" | "mobile";

const VIEWPORTS: readonly { id: PreviewViewport; label: string; width: string; icon: typeof RiComputerLine }[] = [
  { id: "desktop", label: "Desktop", width: "100%", icon: RiComputerLine },
  { id: "tablet", label: "Tablet (768px)", width: "768px", icon: RiTabletLine },
  { id: "mobile", label: "Mobile (390px)", width: "390px", icon: RiSmartphoneLine },
];

export interface PreviewSplitPaneProps {
  open: boolean;
  kind: "collection" | "global";
  slug: string;
  id?: string;
  /** Live working document payload (system fields + unsaved form data) posted via postMessage. */
  liveDoc: Record<string, unknown>;
  /** Unsaved form field values sent when resolving `admin.previewUrl(doc)`. */
  formData: Record<string, unknown>;
  /** Optional unsaved slug override (collections only). */
  docSlug?: string | null;
  /** Changes after saves/unpublishes to refresh the preview session & iframe. */
  savedVersion?: string | null;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Split-pane Live Preview wrapper for `DocumentEditor` and `GlobalEditor`.
 * Renders `{children}` unchanged when `open === false`.
 * When open, resolves a signed preview entry URL, renders a responsive viewport iframe,
 * and posts debounced unsaved form state to the preview frame using strict origin targeting.
 */
export function PreviewSplitPane({
  open,
  kind,
  slug,
  id,
  liveDoc,
  formData,
  docSlug,
  savedVersion,
  onClose,
  children,
}: PreviewSplitPaneProps) {
  const { services } = useAdmin();
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const liveDocRef = useRef(liveDoc);
  liveDocRef.current = liveDoc;
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const docSlugRef = useRef(docSlug);
  docSlugRef.current = docSlug;

  // Fetch a fresh signed preview entry URL on open, save, document switch, or manual refresh.
  useEffect(() => {
    if (!open) return;
    if (!services.previewUrl) {
      setPreview(null);
      setError("Live preview is not available in this environment.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void services
      .previewUrl({
        kind,
        slug,
        id,
        data: formDataRef.current,
        ...(docSlugRef.current !== undefined ? { docSlug: docSlugRef.current } : {}),
      })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setPreview(null);
          setError(res.error.message);
          return;
        }
        setPreview(res.data);
        setFrameKey((k) => k + 1);
      })
      .catch(() => {
        if (cancelled) return;
        setPreview(null);
        setError("Could not load preview URL.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind, slug, id, savedVersion, reloadNonce, services]);

  const resolveTargetOrigin = useCallback((): string | null => {
    if (!preview || typeof window === "undefined") return null;
    return preview.targetOrigin ?? window.location.origin;
  }, [preview]);

  const postLiveUpdate = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    const targetOrigin = resolveTargetOrigin();
    if (!win || !targetOrigin) return;
    const message: LivePreviewUpdateMessage = {
      channel: XENON_PREVIEW_CHANNEL,
      type: "xenon:preview:update",
      kind,
      slug,
      ...(id ? { id } : {}),
      data: liveDocRef.current,
      updatedAt: new Date().toISOString(),
    };
    try {
      win.postMessage(message, targetOrigin);
    } catch {
      // Frame may still be navigating across origins before settling on targetOrigin.
    }
  }, [kind, slug, id, resolveTargetOrigin]);

  // Debounced live updates while editing.
  useEffect(() => {
    if (!open || !preview) return;
    const timer = window.setTimeout(postLiveUpdate, 100);
    return () => window.clearTimeout(timer);
  }, [open, preview, liveDoc, postLiveUpdate]);

  // Respond immediately to `xenon:preview:ready` handshakes from our iframe only.
  useEffect(() => {
    if (!open || !preview || typeof window === "undefined") return;
    const targetOrigin = resolveTargetOrigin();
    if (!targetOrigin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const raw = event.data as Record<string, unknown> | null;
      if (!raw || typeof raw !== "object") return;
      if (raw.channel === XENON_PREVIEW_CHANNEL && raw.type === "xenon:preview:ready") {
        postLiveUpdate();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, preview, resolveTargetOrigin, postLiveUpdate]);

  if (!open) return <>{children}</>;

  const activeViewport = VIEWPORTS.find((v) => v.id === viewport) ?? VIEWPORTS[0]!;

  return (
    <div
      data-xe-full
      data-xe-preview-pane
      className="xe:flex xe:flex-col xe:xl:grid xe:xl:h-[calc(100dvh-3.5rem-2px)] xe:xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="xe:min-w-0 xe:overflow-y-auto xe:[scrollbar-width:thin] xe:[&>[data-xe-full]]:flex xe:[&>[data-xe-full]]:min-h-0 xe:[&>[data-xe-full]]:flex-col xe:[&>[data-xe-full]>aside]:static xe:[&>[data-xe-full]>aside]:h-auto xe:[&>[data-xe-full]>aside]:overflow-visible xe:[&>[data-xe-full]>aside]:border-t xe:[&>[data-xe-full]>aside]:border-l-0">
        {children}
      </div>

      <section
        aria-label="Live preview"
        className="xe:flex xe:min-h-[34rem] xe:flex-col xe:border-t xe:border-border xe:bg-muted/40 xe:xl:min-h-0 xe:xl:border-t-0 xe:xl:border-l"
      >
        <div className="xe:flex xe:h-11 xe:shrink-0 xe:items-center xe:gap-1.5 xe:border-b xe:border-border xe:bg-background xe:px-3">
          <div role="group" aria-label="Preview viewport" className="xe:flex xe:items-center xe:gap-0.5 xe:rounded-md xe:border xe:border-border xe:bg-muted/50 xe:p-0.5">
            {VIEWPORTS.map((preset) => {
              const Icon = preset.icon;
              const selected = viewport === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-label={preset.label}
                  aria-pressed={selected}
                  onClick={() => setViewport(preset.id)}
                  className={cn(
                    "xe:inline-flex xe:size-7 xe:items-center xe:justify-center xe:rounded-sm xe:transition-colors",
                    selected
                      ? "xe:bg-background xe:text-foreground xe:shadow-xs"
                      : "xe:text-muted-foreground xe:hover:text-foreground",
                  )}
                >
                  <Icon className="xe:size-3.5" aria-hidden />
                </button>
              );
            })}
          </div>

          <div className="xe:min-w-0 xe:flex-1 xe:truncate xe:rounded-md xe:bg-muted/60 xe:px-2.5 xe:py-1 xe:font-mono xe:text-xs xe:text-muted-foreground" title={preview?.url ?? undefined}>
            {loading ? "Loading preview…" : preview?.url ?? "No preview URL"}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Reload preview"
            disabled={loading}
            onClick={() => setReloadNonce((n) => n + 1)}
          >
            {loading ? <Spinner /> : <RiRefreshLine />}
          </Button>

          {preview ? (
            <a
              href={preview.enterUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open preview in new tab"
              className="xe:inline-flex xe:size-8 xe:items-center xe:justify-center xe:rounded-md xe:text-muted-foreground xe:transition-colors xe:hover:bg-accent xe:hover:text-foreground"
            >
              <RiExternalLinkLine className="xe:size-4" aria-hidden />
            </a>
          ) : null}

          <Button type="button" variant="ghost" size="icon" aria-label="Close preview" onClick={onClose}>
            <RiCloseLine />
          </Button>
        </div>

        <div className="xe:flex xe:min-h-0 xe:flex-1 xe:justify-center xe:overflow-auto xe:p-3">
          {error ? (
            <div className="xe:m-auto xe:flex xe:max-w-sm xe:flex-col xe:items-center xe:gap-2 xe:rounded-lg xe:border xe:border-border xe:bg-background xe:p-5 xe:text-center">
              <p className="xe:text-sm xe:font-medium xe:text-foreground">Preview unavailable</p>
              <p className="xe:text-xs xe:text-muted-foreground">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadNonce((n) => n + 1)}>
                Try again
              </Button>
            </div>
          ) : loading && !preview ? (
            <div className="xe:m-auto xe:flex xe:items-center xe:gap-2 xe:text-sm xe:text-muted-foreground">
              <Spinner />
              <span>Preparing preview…</span>
            </div>
          ) : preview ? (
            <div
              style={{ width: activeViewport.width, maxWidth: "100%" }}
              className="xe:h-full xe:min-h-[28rem] xe:overflow-hidden xe:rounded-md xe:border xe:border-border xe:bg-background xe:transition-[width] xe:duration-200"
            >
              <iframe
                key={`${frameKey}:${preview.enterUrl}`}
                ref={iframeRef}
                src={preview.enterUrl}
                title={`Live preview for ${slug}`}
                onLoad={postLiveUpdate}
                className="xe:h-full xe:w-full xe:border-0"
              />
            </div>
          ) : (
            <div className="xe:m-auto xe:flex xe:max-w-sm xe:flex-col xe:items-center xe:gap-1.5 xe:rounded-lg xe:border xe:border-border xe:bg-background xe:p-5 xe:text-center">
              <p className="xe:text-sm xe:font-medium xe:text-foreground">No preview URL yet</p>
              <p className="xe:text-xs xe:text-muted-foreground">
                Save a draft or fill in the fields required by this {kind}&rsquo;s preview URL, then reload.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
