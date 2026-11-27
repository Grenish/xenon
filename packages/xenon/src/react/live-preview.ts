"use client";
import { useEffect, useState } from "react";
import {
  type LivePreviewMessage,
  type LivePreviewReadyMessage,
  type LivePreviewUpdateMessage,
  mergeLivePreviewData,
  subscribeLivePreview,
  type SubscribeLivePreviewOptions,
  XENON_PREVIEW_CHANNEL,
} from "../core/preview-protocol";

export {
  mergeLivePreviewData,
  subscribeLivePreview,
  XENON_PREVIEW_CHANNEL,
};
export type {
  LivePreviewMessage,
  LivePreviewReadyMessage,
  LivePreviewUpdateMessage,
  SubscribeLivePreviewOptions,
};

export interface UseLivePreviewOptions<T> {
  /** Server-rendered initial document (or global) returned from the Local API. */
  initialData: T;
  /**
   * Origin of the Xenon Admin hosting the preview iframe.
   * Defaults to `window.location.origin` (same-origin admin).
   */
  serverURL?: string;
  /** Restrict updates to this collection slug. */
  collection?: string;
  /** Restrict updates to this global slug. */
  global?: string;
  /** Restrict updates to this document id. */
  id?: string;
}

export interface UseLivePreviewResult<T> {
  /** Live document state: starts as `initialData` and updates in real time as the editor types. */
  data: T;
  /** `true` once at least one live preview update has arrived from the Xenon Admin iframe host. */
  isLive: boolean;
}

/**
 * React client hook for instant unsaved-state Live Preview inside the Xenon Admin split-pane iframe.
 * Preserves populated relation/media objects when their referenced id hasn't changed.
 */
export function useLivePreview<T>(options: UseLivePreviewOptions<T>): UseLivePreviewResult<T> {
  const { initialData, serverURL, collection, global, id } = options;
  const [data, setData] = useState<T>(initialData);
  const [isLive, setIsLive] = useState(false);

  // Sync with fresh server data after save/refresh.
  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  useEffect(() => {
    return subscribeLivePreview<Record<string, unknown>>({
      serverURL,
      collection,
      global,
      id,
      onData: (incoming) => {
        setIsLive(true);
        setData((prev) => mergeLivePreviewData(prev, incoming));
      },
    });
  }, [serverURL, collection, global, id]);

  return { data, isLive };
}
