"use client";

import { useLayoutEffect, useRef } from "react";
import { Input } from "../components/input";
import { Textarea } from "../components/textarea";
import { Switch } from "../components/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/select";
import { ToggleGroup, ToggleGroupItem } from "../components/toggle-group";
import type { FieldInputProps } from "./field-types";

function controlProps(props: FieldInputProps) {
  return { id: props.id, disabled: props.disabled, readOnly: props.field.admin.readOnly, "aria-invalid": props["aria-invalid"], "aria-describedby": props["aria-describedby"] };
}

export function TextField(props: FieldInputProps) {
  return <Input {...controlProps(props)} value={typeof props.value === "string" ? props.value : ""} placeholder={props.field.admin.placeholder}
    maxLength={props.field.maxLength} onChange={(event) => props.onChange(event.target.value)} />;
}

export function TextareaField(props: FieldInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [props.value]);
  return <Textarea {...controlProps(props)} ref={ref} rows={props.field.rows ?? 4} value={typeof props.value === "string" ? props.value : ""}
    placeholder={props.field.admin.placeholder} maxLength={props.field.maxLength} onChange={(event) => props.onChange(event.target.value)} />;
}

export function NumberField(props: FieldInputProps) {
  return <Input {...controlProps(props)} type="number" inputMode={props.field.integer ? "numeric" : "decimal"}
    min={props.field.min} max={props.field.max} step={props.field.integer ? 1 : "any"} placeholder={props.field.admin.placeholder}
    value={typeof props.value === "number" ? props.value : ""} onChange={(event) => props.onChange(event.target.value === "" ? null : event.target.valueAsNumber)} />;
}

export function BooleanField(props: FieldInputProps) {
  return <Switch {...controlProps(props)} checked={props.value === true} onCheckedChange={(checked) => props.onChange(checked)} />;
}

export function SelectField(props: FieldInputProps) {
  const options = props.field.options ?? [];
  const disabled = props.disabled || props.field.admin.readOnly;
  if (props.field.hasMany) return <ToggleGroup multiple disabled={disabled} value={Array.isArray(props.value) ? props.value as string[] : []}
    id={props.id} aria-labelledby={`${props.id}-label`} aria-invalid={props["aria-invalid"]} aria-describedby={props["aria-describedby"]}
    className="xe:w-full xe:flex-wrap xe:justify-start" onValueChange={(values) => props.onChange(values)}>
    {options.map((item) => <ToggleGroupItem key={item.value} value={item.value} variant="outline">{item.label}</ToggleGroupItem>)}
  </ToggleGroup>;
  const items = [{ value: null, label: props.field.admin.placeholder ?? "Choose an option" }, ...options];
  return <Select items={items} disabled={disabled} value={typeof props.value === "string" ? props.value : null} onValueChange={(value) => props.onChange(value)}>
    <SelectTrigger {...controlProps(props)} className="xe:w-full"><SelectValue /></SelectTrigger>
    <SelectContent alignItemWithTrigger={false}><SelectGroup>{items.map((item) => <SelectItem key={item.value ?? "empty"} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>;
}
