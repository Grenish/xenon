"use client";

import { useId } from "react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../components/field";
import type { ClientField } from "../shared/client-config";
import { BooleanField, NumberField, SelectField, TextareaField, TextField } from "./basic-fields";
import { MediaField } from "./media-field";
import { RelationField } from "./relation-field";
import { RichTextEditor } from "./rich-text-editor";
import type { FieldInputProps } from "./field-types";

export interface FormRendererProps {
  fields: ClientField[];
  data: Record<string, unknown>;
  onChange(name: string, value: unknown): void;
  errors?: Record<string, string>;
  disabled?: boolean;
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
  }
}

export function FormRenderer({ fields, data, onChange, errors = {}, disabled }: FormRendererProps) {
  const prefix = useId();
  return <FieldGroup>{fields.filter((field) => !field.admin.hidden).map((field) => {
    const id = `xe-field-${prefix}-${field.name}`;
    const error = errors[field.name];
    const description = field.admin.description;
    const describedBy = [description ? `${id}-description` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
    return <Field key={field.name} data-invalid={!!error} data-disabled={disabled || field.admin.readOnly}>
      <FieldLabel id={`${id}-label`} htmlFor={id}>{field.label}{field.required ? <span className="xe:text-muted-foreground" aria-hidden="true">*</span> : null}</FieldLabel>
      <Control field={field} id={id} value={data[field.name]} onChange={(value) => onChange(field.name, value)} disabled={disabled}
        aria-invalid={!!error} aria-describedby={describedBy} />
      {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>;
  })}</FieldGroup>;
}
