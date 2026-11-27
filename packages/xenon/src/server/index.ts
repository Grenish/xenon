/**
 * `xenon-cms/server` — framework-agnostic Local API (Node.js runtime).
 */
export { createXenon, slugify } from "./xenon";
export type { CreateXenonInternalOptions } from "./xenon";
export type * from "./types";
export { createXenonAuth, resolveUser, toRole, xenonAuthOptions, AUTH_MODELS } from "../auth";
export { memoryPresence, PRESENCE_TTL_MS } from "./presence";
export type { MemoryPresenceStore } from "./presence";
export { searchTextFor } from "./search";
export {
  buildPreviewCookie,
  clearPreviewCookie,
  createPreviewSession,
  isPreviewRequest,
  PREVIEW_COOKIE_NAME,
  PREVIEW_SESSION_TTL_MS,
  PREVIEW_TOKEN_TTL_MS,
  readPreviewCookie,
  resolvePreviewUrl,
  signPreviewToken,
  verifyPreviewRequest,
  verifyPreviewToken,
} from "./preview";
export type { CreatePreviewSessionArgs, PreviewSessionInfo, PreviewTokenPayload } from "./preview";
export type { PresenceStore, PresenceBeat, PresencePeer, PresenceSnapshot, PresenceUser, PresenceLocation } from "../adapters/types";
export { XenonError, isXenonError } from "../core/errors";
