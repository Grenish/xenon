import type {
  BooleanField,
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
