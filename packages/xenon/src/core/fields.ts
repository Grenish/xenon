import type {
  ArrayField,
  ArrayFieldOptions,
  BlockConfig,
  BlocksField,
  BlocksFieldOptions,
  BooleanField,
  DateField,
  DateFieldOptions,
  EmailField,
  EmailFieldOptions,
  FieldsMap,
  GroupField,
  GroupFieldOptions,
  JsonField,
  JsonFieldOptions,
  UrlField,
  UrlFieldOptions,
  BooleanFieldOptions,
  MediaField,
  NumberField,
  NumberFieldOptions,
  RelationField,
  RelationshipFieldOptions,
  RichTextField,
  RichTextFieldOptions,
  SelectField,
  SelectFieldOptions,
  TextField,
  TextFieldOptions,
  TextareaField,
  TextareaFieldOptions,
} from "./types";

/*
 * Field helpers. `const` type parameters capture literal option types
 * (`required: true`, select option values, `relationTo`) so users never need `as const`.
 */

export function text<const O extends TextFieldOptions = {}>(options?: O): TextField<O> {
  return { ...(options as O), type: "text" };
}

export function textarea<const O extends TextareaFieldOptions = {}>(options?: O): TextareaField<O> {
  return { ...(options as O), type: "textarea" };
}

export function number<const O extends NumberFieldOptions = {}>(options?: O): NumberField<O> {
  return { ...(options as O), type: "number" };
}

export function boolean<const O extends BooleanFieldOptions = {}>(options?: O): BooleanField<O> {
  return { ...(options as O), type: "boolean" };
}

export function select<const O extends SelectFieldOptions>(options: O): SelectField<O> {
  return { ...options, type: "select" };
}

export function richText<const O extends RichTextFieldOptions = {}>(options?: O): RichTextField<O> {
  return { ...(options as O), type: "richText" };
}

export function media<const O extends RelationshipFieldOptions>(options: O): MediaField<O> {
  return { ...options, type: "media" };
}

export function relation<const O extends RelationshipFieldOptions>(options: O): RelationField<O> {
  return { ...options, type: "relation" };
}

/** A calendar date, stored as `YYYY-MM-DD`. */
export function date<const O extends DateFieldOptions = {}>(options?: O): DateField<O> {
  return { ...(options as O), type: "date" };
}

/** A point in time, stored as an ISO-8601 UTC timestamp (`2026-11-25T09:30:00.000Z`). */
export function datetime<const O extends DateFieldOptions = {}>(
  options?: O,
): DateField<O> & { readonly time: true } {
  return { ...(options as O), type: "date", time: true };
}

export function email<const O extends EmailFieldOptions = {}>(options?: O): EmailField<O> {
  return { ...(options as O), type: "email" };
}

/** An absolute URL. Only `http:` / `https:` by default (see `protocols`). */
export function url<const O extends UrlFieldOptions = {}>(options?: O): UrlField<O> {
  return { ...(options as O), type: "url" };
}

/** Arbitrary JSON. Pass a Standard Schema (e.g. Zod) as `schema` to type and validate it. */
export function json<const O extends JsonFieldOptions = {}>(options?: O): JsonField<O> {
  return { ...(options as O), type: "json" };
}

/** A nested object of fields. Always reads as an object. */
export function group<const O extends GroupFieldOptions>(options: O): GroupField<O> {
  return { ...options, type: "group" };
}

/** A repeatable, ordered list of rows. Each row gets a stable string `id`. Always reads as an array. */
export function array<const O extends ArrayFieldOptions>(options: O): ArrayField<O> {
  return { ...options, type: "array" };
}

/** Defines a block type for `blocks()`. Identity at runtime. */
export function defineBlock<const Slug extends string, const Fs extends FieldsMap>(
  block: BlockConfig<Slug, Fs>,
): BlockConfig<Slug, Fs> {
  return block;
}

/** A page-builder list: each item is one of `blocks`, tagged by `blockType`. Always reads as an array. */
export function blocks<const O extends BlocksFieldOptions>(options: O): BlocksField<O> {
  return { ...options, type: "blocks" };
}
