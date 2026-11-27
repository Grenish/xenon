/**
 * Lifecycle hook types and hook name lists (#12). The runtime lives in `src/server/hooks.ts`.
 *
 * Execution order for a write (`create` / `update`, Local API, REST and admin alike):
 *   access → field `beforeValidate` → collection `beforeValidate` → validation →
 *   field `beforeChange` → collection `beforeChange` → database write → `onChange` →
 *   field `afterChange` → collection `afterChange` → field `afterRead` → collection `afterRead` → result.
 *
 * Reads run field `afterRead` then collection `afterRead` on every returned document, populated
 * documents included (before `select` projection). Deletes run `beforeDelete` → delete → `afterDelete`.
 */
import type { XenonInstance } from "../server/types";
import type { AnyCollection, XenonUser } from "./types";

export type MaybeArray<T> = T | readonly T[];
type MaybePromise<T> = T | Promise<T>;
type AnyDoc = Record<string, unknown>;

/** Write operations that run `beforeValidate` / `beforeChange`. */
export type HookOperation = "create" | "update";

/**
 * Shared, mutable per-operation bag. The same object reaches every hook of one Local API call, and
 * the `xenon` instance handed to hooks forwards it to nested calls (pass `context` explicitly to a
 * Local API call to start from your own object).
 */
export type HookContext = Record<string, unknown>;

export interface HookBaseArgs {
  /** The collection being operated on. */
  collection: AnyCollection;
  /** Acting user (`null` for anonymous or trusted server calls without a user). */
  user: XenonUser | null;
  /**
   * Local API for side effects (e.g. writing another collection). Calls made through it carry the
   * operation's `context` and count toward the hook recursion limit, so a hook that re-triggers
   * itself fails fast instead of looping forever. Defaults to `overrideAccess: true`.
   */
  xenon: XenonInstance;
  context: HookContext;
}

/* --------------------------------- collection -------------------------------- */

export interface BeforeValidateHookArgs<D, Doc> extends HookBaseArgs {
  operation: HookOperation;
  /** `true` for a draft save (validated in draft mode, live content untouched). */
  draft: boolean;
  /**
   * Unvalidated data: the input on `create`, the merged working copy (stored data + patch) on
   * `update`. Mutate it or return a replacement.
   */
  data: Partial<D>;
  /** Working copy (`draftData ?? data`) before this write; `null` on `create`. */
  originalDoc: Doc | null;
}

export interface BeforeChangeHookArgs<D, Doc> extends HookBaseArgs {
  operation: HookOperation;
  draft: boolean;
  /**
   * Validated data about to be stored (complete unless `draft`). What you return is stored as-is
   * (trimmed to the schema, not validated again).
   */
  data: Partial<D>;
  originalDoc: Doc | null;
}

export interface AfterChangeHookArgs<Doc> extends HookBaseArgs {
  operation: HookOperation | "unpublish";
  draft: boolean;
  /** The document as written (draft view for draft saves and unpublish). */
  doc: Doc;
  /** The same document before the write; `null` on `create`. */
  previousDoc: Doc | null;
}

export interface AfterReadHookArgs<Doc> extends HookBaseArgs {
  /** `true` when the document was read as a working copy (`draft: true`). */
  draft: boolean;
  doc: Doc;
}

export interface DeleteHookArgs<Doc> extends HookBaseArgs {
  id: string;
  /** The document being deleted (working-copy view). */
  doc: Doc;
}

/** Return replacement data, or nothing to keep the (possibly mutated) `data`. */
export type BeforeValidateHook<D = AnyDoc, Doc = AnyDoc> = (
  args: BeforeValidateHookArgs<D, Doc>,
) => MaybePromise<Partial<D> | void>;
export type BeforeChangeHook<D = AnyDoc, Doc = AnyDoc> = (
  args: BeforeChangeHookArgs<D, Doc>,
) => MaybePromise<Partial<D> | void>;
/** Runs after the write is committed; a thrown error reaches the caller but does not undo the write. */
export type AfterChangeHook<Doc = AnyDoc> = (args: AfterChangeHookArgs<Doc>) => MaybePromise<void>;
/** Return a replacement document, or nothing to keep the (possibly mutated) `doc`. */
export type AfterReadHook<Doc = AnyDoc> = (args: AfterReadHookArgs<Doc>) => MaybePromise<Doc | void>;
/** Throw (e.g. `new XenonError("FORBIDDEN", …)`) to abort the delete. */
export type BeforeDeleteHook<Doc = AnyDoc> = (args: DeleteHookArgs<Doc>) => MaybePromise<void>;
/** Runs after the row (and its stored file) is gone; errors reach the caller. */
export type AfterDeleteHook<Doc = AnyDoc> = (args: DeleteHookArgs<Doc>) => MaybePromise<void>;

/** Collection-level hooks. Each accepts one function or an array run in order. */
export interface CollectionHooks<D = AnyDoc, Doc = AnyDoc> {
  beforeValidate?: MaybeArray<BeforeValidateHook<D, Doc>>;
  beforeChange?: MaybeArray<BeforeChangeHook<D, Doc>>;
  afterChange?: MaybeArray<AfterChangeHook<Doc>>;
  afterRead?: MaybeArray<AfterReadHook<Doc>>;
  beforeDelete?: MaybeArray<BeforeDeleteHook<Doc>>;
  afterDelete?: MaybeArray<AfterDeleteHook<Doc>>;
}

// biome-ignore lint/suspicious/noExplicitAny: erased hook signatures so every typed collection fits `AnyCollection`.
type ErasedHook = (args: any) => unknown;

/** Hooks of any collection (signatures erased). */
export type AnyCollectionHooks = { readonly [K in keyof CollectionHooks]?: MaybeArray<ErasedHook> };

export const COLLECTION_HOOK_NAMES = [
  "beforeValidate",
  "beforeChange",
  "afterChange",
  "afterRead",
  "beforeDelete",
  "afterDelete",
] as const satisfies readonly (keyof CollectionHooks)[];

/* ----------------------------------- field ----------------------------------- */

export interface FieldHookArgs<V> extends HookBaseArgs {
  /** Current value (`beforeValidate` sees it unvalidated). */
  value: V | null | undefined;
  /** The object holding this field: the document data, a `group` value, or an `array` / `blocks` row. */
  siblingData: AnyDoc;
  /** The whole document data. */
  data: AnyDoc;
  /** Location from the document root, e.g. `["seo", "title"]` or `["links", 0, "url"]`. */
  path: readonly (string | number)[];
  draft: boolean;
  /** Working copy before the write (`null` on `create` and on reads). */
  originalDoc: AnyDoc | null;
}

export interface FieldChangeHookArgs<V> extends FieldHookArgs<V> {
  operation: HookOperation;
}

export interface FieldAfterChangeHookArgs<V> extends FieldHookArgs<V> {
  operation: HookOperation | "unpublish";
}

/** Return the new value, or nothing (`undefined`) to keep it. Return `null` to clear it. */
export type FieldChangeHook<V> = (args: FieldChangeHookArgs<V>) => MaybePromise<V | null | undefined | void>;
export type FieldAfterChangeHook<V> = (args: FieldAfterChangeHookArgs<V>) => MaybePromise<void>;
export type FieldAfterReadHook<V> = (args: FieldHookArgs<V>) => MaybePromise<V | null | undefined | void>;

/**
 * Field-level hooks. They run before the collection hook of the same stage, depth-first (a
 * container's own hook runs after the hooks of its nested fields), and in every `array` / `blocks` row.
 */
export interface FieldHooks<V> {
  beforeValidate?: MaybeArray<FieldChangeHook<V>>;
  beforeChange?: MaybeArray<FieldChangeHook<V>>;
  afterChange?: MaybeArray<FieldAfterChangeHook<V>>;
  afterRead?: MaybeArray<FieldAfterReadHook<V>>;
}

export const FIELD_HOOK_NAMES = [
  "beforeValidate",
  "beforeChange",
  "afterChange",
  "afterRead",
] as const satisfies readonly (keyof FieldHooks<unknown>)[];
