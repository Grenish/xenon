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
export type * from "./core/types";
export type * from "./adapters/types";
export { SlugConflictError, UpdateConflictError } from "./adapters/types";
