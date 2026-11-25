"use client";

import { useEffect, useState } from "react";
import { Input } from "../components/input";
import { Textarea } from "../components/textarea";
import type { FieldInputProps } from "./field-types";

function controlProps(props: FieldInputProps) {
  return { id: props.id, disabled: props.disabled, readOnly: props.field.admin.readOnly, "aria-invalid": props["aria-invalid"], "aria-describedby": props["aria-describedby"] };
}

const emptyAsNull = (value: string) => (value === "" ? null : value);

/** ISO timestamp → the `YYYY-MM-DDTHH:mm` local wall time a `datetime-local` input shows. */
export function toLocalDateTime(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** A `datetime-local` value (local wall time) → ISO timestamp in UTC, or `null` when empty / invalid. */
export function fromLocalDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function DateField(props: FieldInputProps) {
  const { field } = props;
  if (field.time) {
    return <Input {...controlProps(props)} type="datetime-local" value={toLocalDateTime(props.value)}
      min={field.minDate ? toLocalDateTime(field.minDate) : undefined} max={field.maxDate ? toLocalDateTime(field.maxDate) : undefined}
      onChange={(event) => props.onChange(fromLocalDateTime(event.target.value))} />;
  }
  return <Input {...controlProps(props)} type="date" value={typeof props.value === "string" ? props.value : ""}
    min={field.minDate} max={field.maxDate} onChange={(event) => props.onChange(emptyAsNull(event.target.value))} />;
}

export function EmailField(props: FieldInputProps) {
  return <Input {...controlProps(props)} type="email" autoComplete="off" spellCheck={false} placeholder={props.field.admin.placeholder ?? "name@example.com"}
    value={typeof props.value === "string" ? props.value : ""} onChange={(event) => props.onChange(emptyAsNull(event.target.value))} />;
}

export function UrlField(props: FieldInputProps) {
  return <Input {...controlProps(props)} type="url" inputMode="url" spellCheck={false} placeholder={props.field.admin.placeholder ?? "https://"}
    value={typeof props.value === "string" ? props.value : ""} onChange={(event) => props.onChange(emptyAsNull(event.target.value))} />;
}

const stringify = (value: unknown) => (value === undefined || value === null ? "" : JSON.stringify(value, null, 2));

/**
 * Raw JSON editor. Keeps the text the user types; only valid JSON reaches the form value, so a
 * half-typed edit never overwrites the stored value.
 */
export function JsonField(props: FieldInputProps) {
  const [text, setText] = useState(() => stringify(props.value));
  const [invalid, setInvalid] = useState(false);
  // Follow external changes (reset, a newer version loaded) unless they match what is typed.
  useEffect(() => {
    setText((current) => {
      try {
        if (current.trim() && JSON.stringify(JSON.parse(current)) === JSON.stringify(props.value ?? null)) return current;
      } catch { /* keep going */ }
      return current.trim() === "" && props.value == null ? current : stringify(props.value);
    });
    setInvalid(false);
  }, [props.value]);
  return <div className="xe:flex xe:flex-col xe:gap-1.5">
    <Textarea {...controlProps(props)} aria-invalid={props["aria-invalid"] || invalid} rows={6} spellCheck={false}
      className="xe:font-mono xe:text-xs" placeholder={props.field.admin.placeholder ?? "{ }"} value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (!next.trim()) { setInvalid(false); props.onChange(null); return; }
        try { props.onChange(JSON.parse(next)); setInvalid(false); } catch { setInvalid(true); }
      }} />
    {invalid ? <p className="xe:text-xs xe:text-destructive">Not valid JSON yet. The last valid value is kept.</p> : null}
  </div>;
}
