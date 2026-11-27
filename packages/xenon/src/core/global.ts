import type { z } from "zod";
import type {
  AccessFn,
  AnyCollection,
  DocumentStatus,
  Field,
  FieldsMap,
  InferFieldsCreateInput,
  InferFieldsData,
  InferFieldsDraftInput,
  PopulatedFieldsData,
  PopulateFieldsInput,
  Prettify,
  ProjectObject,
  SelectFieldsInput,
  SystemKey,
  XenonConfig,
} from "./types";
import { GLOBALS_COLLECTION, SYSTEM_KEYS } from "./types";
import { fieldsSchema, type ValidationMode, type ValidationResult } from "./validation";

export { GLOBALS_COLLECTION };

export interface GlobalAccess {
  read?: AccessFn;
  update?: AccessFn;
}

export interface GlobalAdminOptions {
  group?: string;
  description?: string;
}

export interface GlobalConfig<
  Slug extends string = string,
  Fs extends FieldsMap = FieldsMap,
> {
  slug: Slug;
  label?: string;
  fields: Fs;
  /** Draft / publish workflow. Default `true`. */
  drafts?: boolean;
  admin?: GlobalAdminOptions;
  access?: GlobalAccess;
}

/**
 * Any global, regardless of its generics.
 */
export interface AnyGlobal {
  slug: string;
  label?: string;
  fields: FieldsMap;
  drafts?: boolean;
  admin?: GlobalAdminOptions;
  access?: GlobalAccess;
}

export interface DefineGlobalInput<
  Slug extends string,
  Fs extends FieldsMap,
> {
  slug: Slug;
  label?: string;
  fields: Fs;
  drafts?: boolean;
  admin?: GlobalAdminOptions;
  access?: GlobalAccess;
}

/**
 * Defines a global (singleton) document. Identity at runtime; all literal types are preserved for inference.
 * Structural validation happens in `defineConfig`, where cross-collection references can be checked.
 */
export function defineGlobal<
  const Slug extends string,
  const Fs extends FieldsMap,
>(config: DefineGlobalInput<Slug, Fs>): GlobalConfig<Slug, Fs> {
  return config;
}

/* -------------------------------------------------------------------------- */
/*                              Global inference                              */
/* -------------------------------------------------------------------------- */

export interface GlobalSystemFields<Slug extends string = string> {
  id: string;
  slug: Slug;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
}

type GlobalFieldsOf<G> = G extends { fields: infer Fs } ? Fs : never;

/** Field values of a global. */
export type InferGlobalData<G extends AnyGlobal> = InferFieldsData<GlobalFieldsOf<G>>;

/** A full global document as returned by the Local / REST API. */
export type InferGlobalType<G extends AnyGlobal> = Prettify<
  GlobalSystemFields<G["slug"]> & InferGlobalData<G>
>;

/** Input accepted when creating/publishing a full global document. */
export type InferGlobalCreateInput<G extends AnyGlobal> = InferFieldsCreateInput<GlobalFieldsOf<G>>;

/** Input accepted when updating a global document. */
export type InferGlobalUpdateInput<G extends AnyGlobal> = Prettify<Partial<InferGlobalCreateInput<G>>>;

/** Output of draft-mode validation for a global: every field optional and nullable. */
export type InferGlobalDraftInput<G extends AnyGlobal> = InferFieldsDraftInput<GlobalFieldsOf<G>>;

type GlobalsOf<Cfg> = Cfg extends { globals?: infer Gs }
  ? Exclude<Gs, undefined> extends readonly AnyGlobal[]
    ? Exclude<Gs, undefined>[number]
    : never
  : never;

/** Union of global slugs in a config. */
export type GlobalSlug<Cfg> = GlobalsOf<Cfg>["slug"];

/** The global definition with slug `S` in a config (falls back to `AnyGlobal` for an erased `XenonConfig`). */
export type GlobalBySlug<Cfg, S extends GlobalSlug<Cfg>> = [
  Extract<GlobalsOf<Cfg>, { slug: S }>,
] extends [never]
  ? GlobalsOf<Cfg>
  : Extract<GlobalsOf<Cfg>, { slug: S }>;

/** Map of slug → document type for every global in a config. */
export type InferConfigGlobals<Cfg> = {
  [S in GlobalSlug<Cfg>]: InferGlobalType<GlobalBySlug<Cfg, S>>;
};

/** Inclusion projection for a global (`id` is always preserved in the returned document). */
export type SelectGlobalInput<G extends AnyGlobal> = Prettify<
  { readonly [K in SystemKey]?: true } & SelectFieldsInput<GlobalFieldsOf<G>>
>;

/** Explicit typed populate tree for global `S` in config `Cfg`. */
export type PopulateGlobalInput<Cfg, S extends GlobalSlug<Cfg>, Depth extends number = 4> =
  GlobalBySlug<Cfg, S> extends infer G extends AnyGlobal ? PopulateFieldsInput<Cfg, GlobalFieldsOf<G>, Depth> : never;

/** Exact inferred global document type for a read with optional `select` and `populate`. */
export type InferQueryGlobalType<Cfg, G extends AnyGlobal, Sel = undefined, Pop = undefined> = [
  Sel,
] extends [undefined]
  ? [Pop] extends [undefined]
    ? InferGlobalType<G>
    : Prettify<GlobalSystemFields<G["slug"]> & PopulatedFieldsData<Cfg, GlobalFieldsOf<G>, Pop>>
  : ProjectObject<
      Prettify<GlobalSystemFields<G["slug"]> & PopulatedFieldsData<Cfg, GlobalFieldsOf<G>, Pop>>,
      Exclude<Sel, undefined>,
      Pop,
      true
    >;

/* -------------------------------------------------------------------------- */
/*                                 Validation                                 */
/* -------------------------------------------------------------------------- */

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const GLOBAL_RESERVED_KEYS = new Set<string>(SYSTEM_KEYS);

type GlobalModeOutput<G extends AnyGlobal, M extends ValidationMode> = M extends "create"
  ? InferGlobalCreateInput<G>
  : M extends "update"
    ? InferGlobalUpdateInput<G>
    : InferGlobalDraftInput<G>;

const globalSchemaCache = new WeakMap<AnyGlobal, Map<ValidationMode, z.ZodType>>();

/** Builds (and caches) a Zod schema for a global's input data. Unknown keys are rejected. */
export function buildGlobalSchema<G extends AnyGlobal, M extends ValidationMode>(
  global: G,
  options: { mode: M },
): z.ZodType<GlobalModeOutput<G, M>> {
  const { mode } = options;
  let byMode = globalSchemaCache.get(global);
  const cached = byMode?.get(mode);
  if (cached) return cached as z.ZodType<GlobalModeOutput<G, M>>;

  const schema = fieldsSchema(global.fields, mode);
  if (!byMode) globalSchemaCache.set(global, (byMode = new Map()));
  byMode.set(mode, schema);
  return schema as unknown as z.ZodType<GlobalModeOutput<G, M>>;
}

/** Validates input data for a global. Never throws for invalid data. */
export function validateGlobalData<G extends AnyGlobal, M extends ValidationMode>(
  global: G,
  input: unknown,
  options: { mode: M },
): ValidationResult<GlobalModeOutput<G, M>> {
  const result = buildGlobalSchema(global, options).safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    issues: result.error.issues.map((i) => ({
      path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
      message: i.message,
    })),
  };
}

function forbidGlobalIndexes(
  slug: string,
  fields: Record<string, Field>,
  path: string,
  configError: (message: string) => Error,
): void {
  for (const [key, field] of Object.entries(fields)) {
    const at = path ? `${path}.${key}` : key;
    if (typeof field !== "object" || field === null || typeof field.type !== "string") continue;
    const indexable = field as { index?: unknown; unique?: unknown };
    if (indexable.index === true || indexable.unique === true) {
      const opt = indexable.unique === true ? "unique" : "index";
      throw configError(
        `[xenon] Invalid config in global "${slug}" → field "${at}": ${opt} is not supported on global fields.`,
      );
    }
    if (field.type === "group") {
      forbidGlobalIndexes(slug, field.fields as Record<string, Field>, at, configError);
    }
  }
}

/**
 * Validates `config.globals` inside `defineConfig`.
 * Reuses the collection field validator so all field rules (relations, conditions, composite fields, etc.) stay in sync.
 */
export function validateGlobalsConfig(
  globals: readonly AnyGlobal[] | undefined,
  collectionsBySlug: Map<string, AnyCollection>,
  validateFieldsFn: (
    slug: string,
    fields: Record<string, Field>,
    path: string,
    reserved: Set<string>,
    bySlug: Map<string, AnyCollection>,
    inRepeater?: boolean,
  ) => void,
  configError: (message: string) => Error,
): void {
  if (!globals) return;
  const seen = new Set<string>();
  for (const g of globals) {
    if (typeof g.slug !== "string" || !SLUG_RE.test(g.slug)) {
      throw configError(
        `[xenon] Invalid global slug "${String(g.slug)}": use lowercase letters, digits and dashes, starting with a letter.`,
      );
    }
    if (seen.has(g.slug)) {
      throw configError(`[xenon] Duplicate global slug "${g.slug}".`);
    }
    seen.add(g.slug);
  }
  for (const g of globals) {
    const fields = g.fields as Record<string, Field>;
    forbidGlobalIndexes(g.slug, fields, "", configError);
    try {
      validateFieldsFn(g.slug, fields, "", GLOBAL_RESERVED_KEYS, collectionsBySlug);
    } catch (err) {
      if (err instanceof Error && err.name === "XenonConfigError") {
        throw configError(err.message.replace(`in collection "${g.slug}"`, `in global "${g.slug}"`));
      }
      throw err;
    }
  }
}

/** Looks up a global by slug, or `undefined`. */
export function getGlobal<Cfg extends XenonConfig>(
  config: Cfg,
  slug: string,
): (Cfg["globals"] extends readonly AnyGlobal[] ? Cfg["globals"][number] : AnyGlobal) | undefined {
  return (config.globals ?? []).find((g) => g.slug === slug) as
    | (Cfg["globals"] extends readonly AnyGlobal[] ? Cfg["globals"][number] : AnyGlobal)
    | undefined;
}
