import type {
  AutosaveOption,
  CollectionAccess,
  CollectionConfig,
  CollectionHookData,
  CollectionHookDoc,
  CollectionHooks,
  FieldsMap,
  SystemKey,
  TextFieldKeys,
  UploadOptions,
  VersionsOption,
} from "./types";

export interface DefineCollectionInput<
  Slug extends string,
  Fs extends FieldsMap,
  Up extends boolean | UploadOptions,
> {
  slug: Slug;
  labels?: { singular?: string; plural?: string };
  fields: Fs;
  slugFrom?: NoInfer<TextFieldKeys<Fs>>;
  drafts?: boolean;
  /** Version history (see `VersionsOption`). Default `false`. */
  versions?: VersionsOption;
  /** Soft delete with a restorable trash. Default `false`. */
  trash?: boolean;
  upload?: Up;
  admin?: {
    useAsTitle?: NoInfer<keyof Fs & string>;
    defaultColumns?: readonly NoInfer<(keyof Fs & string) | SystemKey>[];
    group?: string;
    description?: string;
    /** Admin draft autosave (see `AutosaveOption`). Default `false`. */
    autosave?: AutosaveOption;
  };
  access?: CollectionAccess;
  /** Lifecycle hooks, typed from `fields`. Server-only. */
  hooks?: NoInfer<CollectionHooks<CollectionHookData<Fs, Up>, CollectionHookDoc<Fs, Up>>>;
}

export const DEFAULT_MAX_VERSIONS = 50;
export const DEFAULT_AUTOSAVE_INTERVAL = 2000;
/** Lower bound for `admin.autosave.interval`, so autosave can't flood the server. */
export const MIN_AUTOSAVE_INTERVAL = 500;

/** How many versions a collection keeps per document, or `null` when versions are off. */
export function versionsMax(collection: { versions?: VersionsOption }): number | null {
  const v = collection.versions;
  if (!v) return null;
  return v === true ? DEFAULT_MAX_VERSIONS : (v.max ?? DEFAULT_MAX_VERSIONS);
}

/** Admin autosave delay in ms, or `null` when autosave is off. */
export function autosaveInterval(collection: { admin?: { autosave?: AutosaveOption } }): number | null {
  const a = collection.admin?.autosave;
  if (!a) return null;
  return a === true ? DEFAULT_AUTOSAVE_INTERVAL : (a.interval ?? DEFAULT_AUTOSAVE_INTERVAL);
}

/**
 * Defines a collection. Identity at runtime; all literal types are preserved for inference.
 * Structural validation happens in `defineConfig`, where cross-collection checks are possible.
 */
export function defineCollection<
  const Slug extends string,
  const Fs extends FieldsMap,
  const Up extends boolean | UploadOptions = false,
>(config: DefineCollectionInput<Slug, Fs, Up>): CollectionConfig<Slug, Fs, Up> {
  return config;
}
