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

/**
 * Normalizes form data before submission: cleared `text`/`textarea` inputs (`""`) become `null`
 * (unless the field explicitly defaults to `""`) so optional/draft `minLength` and `pattern` checks
 * don't reject cleared inputs on the server.
 */
export function normalizeFormData(fields: ClientField[], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const field of fields) {
    if ((field.type === "text" || field.type === "textarea") && out[field.name] === "" && field.defaultValue !== "") {
      out[field.name] = null;
    }
  }
  return out;
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
      else if (field.maxLength !== undefined && value.length > field.maxLength) errors[field.name] = `Use ${field.maxLength} characters or fewer.`;
      else if (field.type === "text" && field.pattern) {
        try {
          if (!new RegExp(field.pattern.source, field.pattern.flags).test(value)) {
            errors[field.name] = `${field.label} doesn't match the required format.`;
          }
        } catch {
          // Server validation still enforces the real RegExp if flags/source fail to reconstruct.
        }
      }
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

