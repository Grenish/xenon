import type {
  CollectionAccess,
  CollectionConfig,
  CollectionHookData,
  CollectionHookDoc,
  CollectionHooks,
  FieldsMap,
  SystemKey,
  TextFieldKeys,
  UploadOptions,
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
  upload?: Up;
  admin?: {
    useAsTitle?: NoInfer<keyof Fs & string>;
    defaultColumns?: readonly NoInfer<(keyof Fs & string) | SystemKey>[];
    group?: string;
    description?: string;
    /** Returns the preview URL for a document (relative path or trusted-origin URL), or nullish if not previewable. Server-only. */
    previewUrl?: (doc: NoInfer<CollectionHookDoc<Fs, Up>>) => string | null | undefined;
  };
  access?: CollectionAccess;
  /** Lifecycle hooks, typed from `fields`. Server-only. */
  hooks?: NoInfer<CollectionHooks<CollectionHookData<Fs, Up>, CollectionHookDoc<Fs, Up>>>;
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
