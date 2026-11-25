"use client";

import { useId } from "react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "../components/field";
import type { ClientField } from "../shared/client-config";
import { BooleanField, NumberField, SelectField, TextareaField, TextField } from "./basic-fields";
import { ArrayField, BlocksField, GroupField } from "./container-fields";
import { MediaField } from "./media-field";
import { fieldPath } from "./model";
import { RelationField } from "./relation-field";
import { RichTextEditor } from "./rich-text-editor";
import { DateField, EmailField, JsonField, UrlField } from "./scalar-fields";
import type { FieldInputProps } from "./field-types";

export interface FormRendererProps {
  fields: ClientField[];
  data: Record<string, unknown>;
  onChange(name: string, value: unknown): void;
  /** Errors keyed by dotted path (`title`, `seo.title`, `links.0.href`). */
  errors?: Record<string, string>;
  disabled?: boolean;
  /** Dotted path of the object being rendered (nested groups, rows and blocks). */
  path?: string;
}

function Control(props: FieldInputProps) {
  switch (props.field.type) {
    case "text": return <TextField {...props} />;
    case "textarea": return <TextareaField {...props} />;
    case "number": return <NumberField {...props} />;
    case "boolean": return <BooleanField {...props} />;
    case "select": return <SelectField {...props} />;
    case "richText": return <RichTextEditor {...props} />;
    case "media": return <MediaField {...props} />;
    case "relation": return <RelationField {...props} />;
    case "date": return <DateField {...props} />;
    case "email": return <EmailField {...props} />;
    case "url": return <UrlField {...props} />;
    case "json": return <JsonField {...props} />;
    case "group": return <GroupField {...props} />;
    case "array": return <ArrayField {...props} />;
    case "blocks": return <BlocksField {...props} />;
  }
}

const isContainer = (field: ClientField) => field.type === "group" || field.type === "array" || field.type === "blocks";

export function FormRenderer({ fields, data, onChange, errors = {}, disabled, path }: FormRendererProps) {
  const prefix = useId();
  return <FieldGroup>{fields.filter((field) => !field.admin.hidden).map((field) => {
    const key = fieldPath(path, field.name);
    const id = `xe-field-${prefix}-${field.name}`;
    const error = errors[key];
    const description = field.admin.description;
    const describedBy = [description ? `${id}-description` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
    const required = field.required ? <span className="xe:text-muted-foreground" aria-hidden="true">*</span> : null;
    const control = <Control field={field} id={id} value={data[field.name]} onChange={(value) => onChange(field.name, value)} disabled={disabled}
      aria-invalid={!!error} aria-describedby={describedBy} path={key} errors={errors} />;
    if (isContainer(field)) {
      // Containers hold several controls, so they are a labelled fieldset rather than a label + input.
      return <FieldSet key={field.name} data-invalid={!!error} aria-describedby={describedBy} className="xe:gap-2">
        <FieldLegend variant="label" className="xe:mb-0">{field.label}{required}</FieldLegend>
        {description ? <FieldDescription id={`${id}-description`} className="xe:-mt-1">{description}</FieldDescription> : null}
        {control}
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </FieldSet>;
    }
    return <Field key={field.name} data-invalid={!!error} data-disabled={disabled || field.admin.readOnly}>
      <FieldLabel id={`${id}-label`} htmlFor={id}>{field.label}{required}</FieldLabel>
      {control}
      {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>;
  })}</FieldGroup>;
}
