/**
 * `xenon-cms/server` — framework-agnostic Local API (Node.js runtime).
 */
export { createXenon, slugify } from "./xenon";
export type { CreateXenonInternalOptions } from "./xenon";
export type * from "./types";
export { createXenonAuth, resolveUser, toRole, xenonAuthOptions, AUTH_MODELS } from "../auth";
export { memoryPresence, PRESENCE_TTL_MS } from "./presence";
export type { MemoryPresenceStore } from "./presence";
export type { PresenceStore, PresenceBeat, PresencePeer, PresenceSnapshot, PresenceUser, PresenceLocation } from "../adapters/types";
export { XenonError, isXenonError } from "../core/errors";
