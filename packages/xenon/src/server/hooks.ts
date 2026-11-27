/**
 * Lifecycle hook runtime (#12). Order and semantics are documented on the types in `core/hooks.ts`.
 */
import type { AnyCollection, Field, FieldsMap } from "../core/types";
import type { HookBaseArgs, HookOperation, MaybeArray } from "../core/hooks";

type AnyDoc = Record<string, unknown>;
// biome-ignore lint/suspicious/noExplicitAny: hooks are stored with erased signatures.
type ErasedHook = (args: any) => unknown;

export type FieldStage = "beforeValidate" | "beforeChange" | "afterChange" | "afterRead";
export type CollectionStage = FieldStage | "beforeDelete" | "afterDelete";

/** Nested Local API calls made from hooks deeper than this fail (a hook that keeps re-triggering itself). */
export const MAX_HOOK_DEPTH = 16;

const isRecord = (v: unknown): v is AnyDoc => typeof v === "object" && v !== null && !Array.isArray(v);

export function hookList(hooks: MaybeArray<ErasedHook> | undefined): readonly ErasedHook[] {
  if (hooks === undefined) return [];
  return typeof hooks === "function" ? [hooks] : (hooks as readonly ErasedHook[]);
}

/* ---------------------------------- field ---------------------------------- */

const fieldStageCache = new WeakMap<object, ReadonlySet<FieldStage>>();

/** Stages for which `field` or anything nested inside it has a hook. */
function fieldStagesOf(field: Field): ReadonlySet<FieldStage> {
  let cached = fieldStageCache.get(field);
  if (cached) return cached;
  const out = new Set<FieldStage>();
  const own = (field as { hooks?: Partial<Record<FieldStage, MaybeArray<ErasedHook>>> }).hooks;
  if (own) for (const stage of Object.keys(own) as FieldStage[]) if (hookList(own[stage]).length) out.add(stage);
  const nested: FieldsMap[] =
    field.type === "group" || field.type === "array"
      ? [field.fields]
      : field.type === "blocks"
        ? field.blocks.map((b) => b.fields)
        : [];
  for (const fields of nested) for (const s of fieldsStages(fields)) out.add(s);
  cached = out;
  fieldStageCache.set(field, cached);
  return cached;
}

/** Stages for which any field in `fields` (recursively) has a hook. */
export function fieldsStages(fields: FieldsMap): ReadonlySet<FieldStage> {
  let cached = fieldStageCache.get(fields);
  if (cached) return cached;
  const out = new Set<FieldStage>();
  for (const field of Object.values(fields as Record<string, Field>)) for (const s of fieldStagesOf(field)) out.add(s);
  cached = out;
  fieldStageCache.set(fields, cached);
  return cached;
}

export interface FieldHookRun {
  base: HookBaseArgs;
  /** Root data object the walk mutates (document data, or the returned document on reads). */
  data: AnyDoc;
  draft: boolean;
  originalDoc: AnyDoc | null;
  operation?: HookOperation | "unpublish";
}

async function walkFields(
  stage: FieldStage,
  fields: FieldsMap,
  sibling: AnyDoc,
  path: readonly (string | number)[],
  run: FieldHookRun,
): Promise<void> {
  for (const [key, field] of Object.entries(fields as Record<string, Field>)) {
    if (!fieldStagesOf(field).has(stage)) continue;
    const at = [...path, key];
    const value = sibling[key];
    if (field.type === "group" && isRecord(value)) {
      await walkFields(stage, field.fields, value, at, run);
    } else if (field.type === "array" && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const row = value[i];
        if (isRecord(row)) await walkFields(stage, field.fields, row, [...at, i], run);
      }
    } else if (field.type === "blocks" && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const row = value[i];
        if (!isRecord(row)) continue;
        const block = field.blocks.find((b) => b.slug === row.blockType);
        if (block) await walkFields(stage, block.fields, row, [...at, i], run);
      }
    }
    const own = (field as { hooks?: Partial<Record<FieldStage, MaybeArray<ErasedHook>>> }).hooks;
    for (const hook of hookList(own?.[stage])) {
      const result = await hook({
        ...run.base,
        ...(run.operation !== undefined ? { operation: run.operation } : {}),
        value: sibling[key],
        siblingData: sibling,
        data: run.data,
        path: at,
        draft: run.draft,
        originalDoc: run.originalDoc,
      });
      if (stage !== "afterChange" && result !== undefined) sibling[key] = result;
    }
  }
}

/** Runs field hooks of `stage` over `run.data` in place. No-op when no field has such a hook. */
export async function runFieldHooks(stage: FieldStage, fields: FieldsMap, run: FieldHookRun): Promise<void> {
  if (!fieldsStages(fields).has(stage)) return;
  await walkFields(stage, fields, run.data, [], run);
}

/* -------------------------------- collection ------------------------------- */

export function collectionHooks(collection: AnyCollection, stage: CollectionStage): readonly ErasedHook[] {
  return hookList(collection.hooks?.[stage] as MaybeArray<ErasedHook> | undefined);
}

/** True when `collection` has any hook (collection- or field-level) for `stage`. */
export function hasHooks(collection: AnyCollection, stage: CollectionStage): boolean {
  if (collectionHooks(collection, stage).length) return true;
  return stage !== "beforeDelete" && stage !== "afterDelete" && fieldsStages(collection.fields).has(stage);
}

/**
 * Runs collection hooks that pass a value along (`data` / `doc`): each sees the previous one's
 * result; returning `undefined` keeps the current value.
 */
export async function runChainHooks(
  collection: AnyCollection,
  stage: "beforeValidate" | "beforeChange" | "afterRead",
  key: "data" | "doc",
  value: AnyDoc,
  args: AnyDoc,
): Promise<AnyDoc> {
  let current = value;
  for (const hook of collectionHooks(collection, stage)) {
    const result = await hook({ ...args, [key]: current });
    if (result === undefined) continue;
    if (!isRecord(result)) {
      throw new Error(`[xenon] ${collection.slug}.hooks.${stage} must return an object or nothing.`);
    }
    current = result;
  }
  return current;
}

/** Runs side-effect-only collection hooks (`afterChange`, `beforeDelete`, `afterDelete`). */
export async function runEffectHooks(collection: AnyCollection, stage: "afterChange" | "beforeDelete" | "afterDelete", args: AnyDoc): Promise<void> {
  for (const hook of collectionHooks(collection, stage)) await hook(args);
}

/** Replaces the contents of `target` with `source` (keeps object identity for already-linked references). */
export function replaceContents(target: AnyDoc, source: AnyDoc): void {
  if (target === source) return;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}
