/**
 * JSON-safe projection of the Xenon config for client components.
 * Strips functions (validate, access) and converts RegExp to { source, flags }.
 * Isomorphic: safe to import from both server and `"use client"` modules.
 */
import { autosaveInterval, versionsMax } from "../../core/collection";
import type { AnyGlobal } from "../../core/global";
import type { AnyBlock, AnyCollection, Field, FieldAdminOptions, FieldType, SelectOption } from "../../core/types";

export interface ClientBlock {
  slug: string;
  labels: { singular: string; plural: string };
  description: string | null;
  fields: ClientField[];
}

export interface ClientField {
  name: string;
  type: FieldType;
  label: string;
  required: boolean;
  defaultValue?: unknown;
  admin: FieldAdminOptions & { display?: "switch" | "checkbox" };
  // text / textarea
  minLength?: number;
  maxLength?: number;
  pattern?: { source: string; flags: string };
  rows?: number;
  // number
  min?: number;
  max?: number;
  integer?: boolean;
  // select
  options?: { label: string; value: string }[];
  hasMany?: boolean;
  // media / relation
  relationTo?: string;
  // date: `time` → date-time; bounds as ISO strings
  time?: boolean;
  minDate?: string;
  maxDate?: string;
  // url
  protocols?: string[];
  // group / array: nested fields; blocks: block types
  fields?: ClientField[];
  blocks?: ClientBlock[];
  // array / blocks
  minRows?: number;
  maxRows?: number;
  /** array row noun. */
  labels?: { singular: string; plural: string };
}

export interface ClientCollection {
  slug: string;
  labels: { singular: string; plural: string };
  /** Declaration order. */
  fields: ClientField[];
  slugFrom: string | null;
  drafts: boolean;
  /** Version history is kept (#15). */
  versions?: boolean;
  /** Deletes go to a restorable trash (#18). */
  trash?: boolean;
  /** Publishes and unpublishes can be scheduled (drafts + an adapter with `findDue`, #16). */
  scheduling?: boolean;
  upload: false | { mimeTypes: string[] | null; maxFileSize: number | null };
  admin: {
    useAsTitle: string | null;
    defaultColumns: string[];
    group: string | null;
    description: string | null;
    /** Autosave delay in ms, or `null` when autosave is off. */
    autosave?: number | null;
  };
}

export interface ClientGlobal {
  slug: string;
  label: string;
  /** Declaration order. */
  fields: ClientField[];
  drafts: boolean;
  admin: {
    group: string | null;
    description: string | null;
  };
}

/** `readingTime` → `Reading time`, `post_tags` → `Post tags`. */
export function humanize(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const UNCOUNTABLE = new Set(["media", "news", "data", "content", "info", "information", "feedback", "equipment", "software"]);

function pluralize(word: string): string {
  if (UNCOUNTABLE.has(word.toLowerCase())) return word;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

function singularize(word: string): string {
  if (UNCOUNTABLE.has(word.toLowerCase())) return word;
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/(x|z|ch|sh|ss)es$/i.test(word)) return word.slice(0, -2);
  return word.replace(/s$/i, "");
}

function normalizeOptions(options: readonly SelectOption[]) {
  return options.map((o) => (typeof o === "string" ? { label: humanize(o), value: o } : { label: o.label, value: o.value }));
}

function toClientFields(fields: AnyCollection["fields"]): ClientField[] {
  return Object.entries(fields).map(([name, f]) => toClientField(name, f as Field));
}

function toClientBlock(block: AnyBlock): ClientBlock {
  const name = humanize(block.slug);
  return {
    slug: block.slug,
    labels: { singular: block.labels?.singular ?? name, plural: block.labels?.plural ?? pluralize(name) },
    description: block.admin?.description ?? null,
    fields: toClientFields(block.fields),
  };
}

export function toClientField(name: string, field: Field): ClientField {
  const out: ClientField = {
    name,
    type: field.type,
    label: field.label ?? humanize(name),
    required: field.required === true,
    admin: { ...(field.admin ?? {}) },
  };
  if (field.defaultValue !== undefined) out.defaultValue = structuredClone(field.defaultValue);
  switch (field.type) {
    case "text":
      if (field.pattern) out.pattern = { source: field.pattern.source, flags: field.pattern.flags };
    // falls through
    case "textarea":
      if (field.minLength !== undefined) out.minLength = field.minLength;
      if (field.maxLength !== undefined) out.maxLength = field.maxLength;
      if (field.type === "textarea" && field.rows !== undefined) out.rows = field.rows;
      break;
    case "number":
      if (field.min !== undefined) out.min = field.min;
      if (field.max !== undefined) out.max = field.max;
      if (field.integer) out.integer = true;
      break;
    case "select":
      out.options = normalizeOptions(field.options);
      out.hasMany = field.hasMany === true;
      break;
    case "media":
    case "relation":
      out.relationTo = field.relationTo;
      out.hasMany = field.hasMany === true;
      break;
    case "date":
      if (field.time) out.time = true;
      if (field.min !== undefined) out.minDate = field.min;
      if (field.max !== undefined) out.maxDate = field.max;
      break;
    case "url":
      out.protocols = [...(field.protocols ?? ["http", "https"])];
      break;
    case "group":
      out.fields = toClientFields(field.fields);
      break;
    case "array": {
      out.fields = toClientFields(field.fields);
      const noun = singularize(out.label);
      out.labels = { singular: field.labels?.singular ?? (noun === out.label ? "Item" : noun), plural: field.labels?.plural ?? out.label };
      if (field.minRows !== undefined) out.minRows = field.minRows;
      if (field.maxRows !== undefined) out.maxRows = field.maxRows;
      break;
    }
    case "blocks":
      out.blocks = field.blocks.map(toClientBlock);
      if (field.minRows !== undefined) out.minRows = field.minRows;
      if (field.maxRows !== undefined) out.maxRows = field.maxRows;
      break;
  }
  return out;
}

export function toClientCollection(collection: AnyCollection, options: { scheduling?: boolean } = {}): ClientCollection {
  const name = humanize(collection.slug);
  const singular = collection.labels?.singular ?? singularize(name);
  const fields = toClientFields(collection.fields);
  const upload = collection.upload;
  return {
    slug: collection.slug,
    labels: { singular, plural: collection.labels?.plural ?? (singularize(name) === name ? pluralize(name) : name) },
    fields,
    slugFrom: collection.slugFrom ?? null,
    drafts: collection.drafts !== false && !upload,
    versions: versionsMax(collection) !== null,
    trash: collection.trash === true,
    scheduling: options.scheduling === true && collection.drafts !== false && !upload,
    upload: upload
      ? {
          mimeTypes: typeof upload === "object" && upload.mimeTypes ? [...upload.mimeTypes] : null,
          maxFileSize: typeof upload === "object" ? (upload.maxFileSize ?? null) : null,
        }
      : false,
    admin: {
      useAsTitle: collection.admin?.useAsTitle ?? fields.find((f) => f.type === "text")?.name ?? null,
      defaultColumns: [...(collection.admin?.defaultColumns ?? [])],
      group: collection.admin?.group ?? null,
      description: collection.admin?.description ?? null,
      autosave: autosaveInterval(collection),
    },
  };
}

export function toClientGlobal(global: AnyGlobal): ClientGlobal {
  return {
    slug: global.slug,
    label: global.label ?? humanize(global.slug),
    fields: toClientFields(global.fields),
    drafts: global.drafts !== false,
    admin: {
      group: global.admin?.group ?? null,
      description: global.admin?.description ?? null,
    },
  };
}
