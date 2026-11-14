import type {
  CollectionAccess,
  CollectionConfig,
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
  };
  access?: CollectionAccess;
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
