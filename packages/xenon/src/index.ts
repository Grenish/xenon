/**
 * `xenon-cms` — isomorphic entry: schema definition, inference types, validation.
 * Must not import Node built-ins, Next.js, or React.
 */
export {
  text,
  textarea,
  number,
  boolean,
  select,
  richText,
  media,
  relation,
  date,
  datetime,
  email,
  url,
  json,
  group,
  array,
  blocks,
  defineBlock,
} from "./core/fields";
export { defineCollection } from "./core/collection";
export type { DefineCollectionInput } from "./core/collection";
export { defineGlobal, getGlobal, buildGlobalSchema, validateGlobalData } from "./core/global";
export type {
  AnyGlobal,
  DefineGlobalInput,
  GlobalAccess,
  GlobalAdminOptions,
  GlobalBySlug,
  GlobalConfig,
  GlobalSlug,
  GlobalSystemFields,
  InferConfigGlobals,
  InferGlobalCreateInput,
  InferGlobalData,
  InferGlobalDraftInput,
  InferGlobalType,
  InferGlobalUpdateInput,
  InferQueryGlobalType,
  PopulateGlobalInput,
  SelectGlobalInput,
} from "./core/global";
export { defineConfig, getCollection, XenonConfigError } from "./core/config";
export { XenonError, isXenonError } from "./core/errors";
export type { XenonErrorCode } from "./core/errors";
export {
  buildCollectionSchema,
  validateCollectionData,
  validateFieldValue,
  fieldValueSchema,
} from "./core/validation";
export type { ValidationIssue, ValidationMode, ValidationResult } from "./core/validation";
export { SYSTEM_KEYS, UPLOAD_KEYS } from "./core/types";
export { evaluateCondition } from "./core/condition";
export {
  mergeLivePreviewData,
  subscribeLivePreview,
  XENON_PREVIEW_CHANNEL,
} from "./core/preview-protocol";
export type {
  LivePreviewMessage,
  LivePreviewReadyMessage,
  LivePreviewUpdateMessage,
  SubscribeLivePreviewOptions,
} from "./core/preview-protocol";
export type * from "./core/types";
export type * from "./adapters/types";
export { SlugConflictError, UniqueConflictError, UpdateConflictError } from "./adapters/types";
