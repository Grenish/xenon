import type { ClientField } from "../shared/client-config";

export interface FieldInputProps {
  field: ClientField;
  value: unknown;
  onChange(value: unknown): void;
  id: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /** "canvas": borderless writing surface used for the document body. */
  variant?: "default" | "canvas";
  /** Dotted path of this field (`links.0.href`); containers pass it on to their nested fields. */
  path?: string;
  /** Every form error, keyed by dotted path; containers read their nested fields' errors from it. */
  errors?: Record<string, string>;
}
