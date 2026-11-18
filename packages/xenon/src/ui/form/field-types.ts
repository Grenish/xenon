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
}
