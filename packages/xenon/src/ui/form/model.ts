import type { ClientCollection, ClientField } from "../shared/client-config";
import type { AdminDoc } from "../shared/services";
import { normalizeRichText } from "./rich-text-schema";

export function initialData(collection: ClientCollection, doc: AdminDoc | null): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of collection.fields) {
    if (doc && Object.hasOwn(doc.data, field.name)) data[field.name] = structuredClone(doc.data[field.name]);
    else if (field.defaultValue !== undefined) data[field.name] = structuredClone(field.defaultValue);
    // Rich text is held in the editor's own normalized form so an untouched document is never "dirty".
    if (field.type === "richText" && data[field.name] != null) data[field.name] = normalizeRichText(data[field.name]);
  }
  return data;
}

export function validateFields(fields: ClientField[], data: Record<string, unknown>, draft: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.admin.readOnly || field.admin.hidden) continue;
    const value = data[field.name];
    if (value == null || value === "") {
      if (field.required && !draft && field.defaultValue === undefined) errors[field.name] = `${field.label} is required.`;
      continue;
    }
    if (typeof value === "string" && (field.type === "text" || field.type === "textarea")) {
      if (field.minLength !== undefined && value.length < field.minLength) errors[field.name] = `Use at least ${field.minLength} characters.`;
      if (field.maxLength !== undefined && value.length > field.maxLength) errors[field.name] = `Use ${field.maxLength} characters or fewer.`;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) errors[field.name] = "Enter a valid number.";
      else if (field.integer && !Number.isInteger(value)) errors[field.name] = "Enter a whole number.";
      else if (field.min !== undefined && value < field.min) errors[field.name] = `Enter ${field.min} or more.`;
      else if (field.max !== undefined && value > field.max) errors[field.name] = `Enter ${field.max} or less.`;
    }
  }
  return errors;
}

export function documentTitle(collection: ClientCollection, data: Record<string, unknown>): string {
  const title = collection.admin.useAsTitle ? data[collection.admin.useAsTitle] : undefined;
  return typeof title === "string" && title.trim() ? title : `Untitled ${collection.labels.singular.toLowerCase()}`;
}

