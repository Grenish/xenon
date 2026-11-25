import { newRowId } from "../../core/row-id";
import type { ClientBlock, ClientCollection, ClientField } from "../shared/client-config";
import type { AdminDoc } from "../shared/services";
import { normalizeRichText } from "./rich-text-schema";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Joins an error path: `links.0.href`. */
export function fieldPath(prefix: string | undefined, name: string | number): string {
  return prefix ? `${prefix}.${name}` : String(name);
}

/**
 * The editor's form of one value: defaults filled in (containers → `{}` / `[]`, recursively) and rich
 * text held in the editor's own normalized form, so an untouched document is never "dirty".
 */
function formValue(field: ClientField, stored: unknown, present: boolean): unknown {
  let value = present ? structuredClone(stored) : undefined;
  if (value == null && field.defaultValue !== undefined) value = structuredClone(field.defaultValue);
  switch (field.type) {
    case "richText":
      return value != null ? normalizeRichText(value) : value;
    case "group":
      return formData(field.fields ?? [], isRecord(value) ? value : {});
    case "array":
      return (Array.isArray(value) ? value : []).map((row) => ({ ...formData(field.fields ?? [], isRecord(row) ? row : {}), id: isRecord(row) && typeof row.id === "string" ? row.id : newRowId() }));
    case "blocks":
      return (Array.isArray(value) ? value : []).flatMap((item) => {
        const block = isRecord(item) ? field.blocks?.find((b) => b.slug === item.blockType) : undefined;
        // Items of a block type removed from the config can't be edited; they are dropped on the next save.
        if (!block || !isRecord(item)) return [];
        return [{ ...formData(block.fields, item), id: typeof item.id === "string" ? item.id : newRowId(), blockType: block.slug }];
      });
    default:
      return value;
  }
}

function formData(fields: ClientField[], source: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const value = formValue(field, source[field.name], Object.hasOwn(source, field.name));
    if (value !== undefined) data[field.name] = value;
  }
  return data;
}

export function initialData(collection: ClientCollection, doc: AdminDoc | null): Record<string, unknown> {
  return formData(collection.fields, doc?.data ?? {});
}

/** A new `array` row with its fields' defaults. */
export function newArrayRow(field: ClientField): Record<string, unknown> {
  return { ...formData(field.fields ?? [], {}), id: newRowId() };
}

/** A new `blocks` item of type `block` with its fields' defaults. */
export function newBlock(block: ClientBlock): Record<string, unknown> {
  return { ...formData(block.fields, {}), id: newRowId(), blockType: block.slug };
}

function normalizeValue(field: ClientField, value: unknown): unknown {
  if ((field.type === "text" || field.type === "textarea" || field.type === "email" || field.type === "url" || field.type === "date") && value === "" && field.defaultValue !== "") {
    return null;
  }
  if (field.type === "group" && isRecord(value)) return normalizeFormData(field.fields ?? [], value);
  if (field.type === "array" && Array.isArray(value)) {
    return value.map((row) => (isRecord(row) ? { ...normalizeFormData(field.fields ?? [], row), id: row.id } : row));
  }
  if (field.type === "blocks" && Array.isArray(value)) {
    return value.map((item) => {
      const block = isRecord(item) ? field.blocks?.find((b) => b.slug === item.blockType) : undefined;
      return block && isRecord(item) ? { ...normalizeFormData(block.fields, item), id: item.id, blockType: item.blockType } : item;
    });
  }
  return value;
}

/**
 * Normalizes form data before submission: cleared text-like inputs (`""`) become `null` (unless the
 * field explicitly defaults to `""`) so optional/draft `minLength` and `pattern` checks don't reject
 * cleared inputs on the server. Recurses into groups, array rows and blocks.
 */
export function normalizeFormData(fields: ClientField[], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const field of fields) if (Object.hasOwn(out, field.name)) out[field.name] = normalizeValue(field, out[field.name]);
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatBound(value: string, time: boolean | undefined): string {
  const date = new Date(time ? value : `${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return time ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : date.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function rowCount(field: ClientField, count: number, draft: boolean): string | null {
  const min = draft ? 0 : Math.max(field.minRows ?? 0, field.required ? 1 : 0);
  if (count < min) return field.required && min === 1 ? `${field.label} is required.` : `Add at least ${min} ${min === 1 ? "item" : "items"}.`;
  if (field.maxRows !== undefined && count > field.maxRows) return `Use ${field.maxRows} ${field.maxRows === 1 ? "item" : "items"} or fewer.`;
  return null;
}

/**
 * Client-side checks mirroring the server's built-in rules, keyed by dotted path (`links.0.href`).
 * The server stays authoritative; this only gives instant feedback.
 */
export function validateFields(fields: ClientField[], data: Record<string, unknown>, draft: boolean, prefix?: string): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.admin.readOnly || field.admin.hidden) continue;
    const key = fieldPath(prefix, field.name);
    const value = data[field.name];
    if (field.type === "group") {
      Object.assign(errors, validateFields(field.fields ?? [], isRecord(value) ? value : {}, draft, key));
      continue;
    }
    if (field.type === "array" || field.type === "blocks") {
      const rows = Array.isArray(value) ? value : [];
      const count = rowCount(field, rows.length, draft);
      if (count) errors[key] = count;
      rows.forEach((row, i) => {
        if (!isRecord(row)) return;
        const rowFields = field.type === "array" ? field.fields : field.blocks?.find((b) => b.slug === row.blockType)?.fields;
        Object.assign(errors, validateFields(rowFields ?? [], row, draft, fieldPath(key, i)));
      });
      continue;
    }
    if (value == null || value === "") {
      if (field.required && !draft && field.defaultValue === undefined) errors[key] = `${field.label} is required.`;
      continue;
    }
    if (typeof value === "string" && (field.type === "text" || field.type === "textarea")) {
      if (field.minLength !== undefined && value.length < field.minLength) errors[key] = `Use at least ${field.minLength} characters.`;
      else if (field.maxLength !== undefined && value.length > field.maxLength) errors[key] = `Use ${field.maxLength} characters or fewer.`;
      else if (field.type === "text" && field.pattern) {
        try {
          if (!new RegExp(field.pattern.source, field.pattern.flags).test(value)) {
            errors[key] = `${field.label} doesn't match the required format.`;
          }
        } catch {
          // Server validation still enforces the real RegExp if flags/source fail to reconstruct.
        }
      }
    }
    if (field.type === "email" && (typeof value !== "string" || !EMAIL_RE.test(value))) errors[key] = "Enter a valid email address.";
    if (field.type === "url") {
      let parsed: URL | null = null;
      try { parsed = new URL(String(value)); } catch { /* invalid */ }
      if (!parsed) errors[key] = "Enter a full URL, like https://example.com.";
      else if (field.protocols && !field.protocols.includes(parsed.protocol.slice(0, -1).toLowerCase())) {
        errors[key] = `Use a link starting with ${field.protocols.map((p) => `${p}:`).join(" or ")}`;
      }
    }
    if (field.type === "date" && typeof value === "string") {
      const ok = field.time ? !Number.isNaN(Date.parse(value)) : DATE_RE.test(value);
      // Date-times compare as instants (bounds may carry offsets); dates compare as YYYY-MM-DD strings.
      const before = (a: string, b: string) => (field.time ? Date.parse(a) < Date.parse(b) : a < b);
      if (!ok) errors[key] = field.time ? "Enter a valid date and time." : "Enter a valid date.";
      else if (field.minDate && before(value, field.minDate)) errors[key] = `Choose ${formatBound(field.minDate, field.time)} or later.`;
      else if (field.maxDate && before(field.maxDate, value)) errors[key] = `Choose ${formatBound(field.maxDate, field.time)} or earlier.`;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) errors[key] = "Enter a valid number.";
      else if (field.integer && !Number.isInteger(value)) errors[key] = "Enter a whole number.";
      else if (field.min !== undefined && value < field.min) errors[key] = `Enter ${field.min} or more.`;
      else if (field.max !== undefined && value > field.max) errors[key] = `Enter ${field.max} or less.`;
    }
  }
  return errors;
}

export function documentTitle(collection: ClientCollection, data: Record<string, unknown>): string {
  const title = collection.admin.useAsTitle ? data[collection.admin.useAsTitle] : undefined;
  return typeof title === "string" && title.trim() ? title : `Untitled ${collection.labels.singular.toLowerCase()}`;
}
