"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiDraggable,
  RiErrorWarningFill,
} from "@remixicon/react";
import { Button } from "../components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "../components/dropdown-menu";
import { cn } from "../lib/utils";
import type { ClientBlock, ClientField } from "../shared/client-config";
import { FormRenderer } from "./form-renderer";
import type { FieldInputProps } from "./field-types";
import { fieldPath, newArrayRow, newBlock } from "./model";

type Row = Record<string, unknown> & { id: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((r): r is Row => isRecord(r) && typeof r.id === "string") : [];
}

/** Moves `rows[from]` to index `to`. */
export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= rows.length) return [...rows];
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, row!);
  return next;
}

function hasErrorUnder(errors: Record<string, string> | undefined, path: string): boolean {
  if (!errors) return false;
  const prefix = `${path}.`;
  return Object.keys(errors).some((key) => key.startsWith(prefix));
}

/** First non-empty text-like value of a row: a readable title for its header. */
function rowSummary(fields: readonly ClientField[], row: Record<string, unknown>): string | null {
  for (const f of fields) {
    if (f.admin.hidden) continue;
    const v = row[f.name];
    if ((f.type === "text" || f.type === "textarea" || f.type === "email" || f.type === "url") && typeof v === "string" && v.trim()) return v.trim();
    if (f.type === "select" && typeof v === "string") return f.options?.find((o) => o.value === v)?.label ?? v;
  }
  return null;
}

export function GroupField(props: FieldInputProps) {
  const value = isRecord(props.value) ? props.value : {};
  return <div id={props.id} className="xe:rounded-lg xe:border xe:border-border xe:p-4">
    <FormRenderer fields={props.field.fields ?? []} data={value} path={props.path} errors={props.errors} disabled={props.disabled || props.field.admin.readOnly}
      onChange={(name, next) => props.onChange({ ...value, [name]: next })} />
  </div>;
}

interface RowListProps extends FieldInputProps {
  /** Fields and noun for a row (blocks: per block type). */
  describe(row: Row): { fields: ClientField[]; noun: string } | null;
  addControl(onAdd: (row: Row) => void, disabled: boolean): ReactNode;
  emptyText: string;
}

function RowList(props: RowListProps) {
  const rows = rowsOf(props.value);
  const disabled = !!(props.disabled || props.field.admin.readOnly);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [handleArmed, setHandleArmed] = useState<string | null>(null);
  const atMax = props.field.maxRows !== undefined && rows.length >= props.field.maxRows;
  const path = props.path ?? props.field.name;

  const update = (next: Row[]) => props.onChange(next);
  const toggle = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  function drop(event: DragEvent, index: number) {
    event.preventDefault();
    if (dragging !== null) update(moveRow(rows, dragging, dragging < index ? index - 1 : index));
    setDragging(null); setDropAt(null); setHandleArmed(null);
  }

  return <div id={props.id} className="xe:flex xe:flex-col xe:gap-2" aria-describedby={props["aria-describedby"]}>
    {rows.length === 0 ? <p className="xe:rounded-lg xe:border xe:border-dashed xe:border-border xe:px-4 xe:py-3 xe:text-sm xe:text-muted-foreground">{props.emptyText}</p> : null}
    <ol className="xe:flex xe:flex-col xe:gap-2" aria-label={props.field.label}>
      {rows.map((row, index) => {
        const described = props.describe(row);
        if (!described) return null;
        const rowPath = fieldPath(path, index);
        const isCollapsed = collapsed.has(row.id);
        const summary = rowSummary(described.fields, row);
        const title = `${described.noun} ${index + 1}`;
        const invalid = hasErrorUnder(props.errors, rowPath) || !!props.errors?.[rowPath];
        return <li key={row.id}
          draggable={!disabled && handleArmed === row.id}
          onDragStart={(event) => { setDragging(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", row.id); }}
          onDragEnd={() => { setDragging(null); setDropAt(null); setHandleArmed(null); }}
          onDragOver={(event) => {
            if (dragging === null) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            setDropAt(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
          }}
          onDrop={(event) => drop(event, dropAt ?? index)}
          className={cn("xe:relative xe:rounded-lg xe:border xe:border-border xe:bg-card", dragging === index && "xe:opacity-50",
            invalid && "xe:border-destructive/60")}>
          {dropAt === index && dragging !== null ? <span aria-hidden="true" className="xe:absolute xe:-top-1.5 xe:right-0 xe:left-0 xe:h-0.5 xe:rounded xe:bg-primary" /> : null}
          {dropAt === index + 1 && index === rows.length - 1 && dragging !== null ? <span aria-hidden="true" className="xe:absolute xe:right-0 xe:-bottom-1.5 xe:left-0 xe:h-0.5 xe:rounded xe:bg-primary" /> : null}
          <div className="xe:flex xe:items-center xe:gap-1 xe:py-1.5 xe:pr-1.5 xe:pl-1">
            {!disabled ? <span aria-hidden="true" title="Drag to reorder" className="xe:flex xe:size-7 xe:cursor-grab xe:items-center xe:justify-center xe:text-muted-foreground xe:active:cursor-grabbing"
              onPointerDown={() => setHandleArmed(row.id)} onPointerUp={() => setHandleArmed(null)}><RiDraggable className="xe:size-4" /></span> : null}
            <button type="button" className="xe:flex xe:min-w-0 xe:flex-1 xe:items-center xe:gap-1.5 xe:rounded-md xe:px-1 xe:py-1 xe:text-left xe:text-sm xe:outline-none xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring"
              aria-expanded={!isCollapsed} onClick={() => toggle(row.id)}>
              {isCollapsed ? <RiArrowRightSLine className="xe:size-4 xe:shrink-0 xe:text-muted-foreground" /> : <RiArrowDownSLine className="xe:size-4 xe:shrink-0 xe:text-muted-foreground" />}
              <span className="xe:shrink-0 xe:font-medium">{title}</span>
              {summary ? <span className="xe:min-w-0 xe:truncate xe:text-muted-foreground">{summary}</span> : null}
              {invalid ? <RiErrorWarningFill className="xe:size-4 xe:shrink-0 xe:text-destructive" aria-label="Has errors" /> : null}
            </button>
            {!disabled ? <>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${title} up`} disabled={index === 0} onClick={() => update(moveRow(rows, index, index - 1))}><RiArrowUpLine /></Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${title} down`} disabled={index === rows.length - 1} onClick={() => update(moveRow(rows, index, index + 1))}><RiArrowDownLine /></Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${title}`} onClick={() => update(rows.filter((r) => r.id !== row.id))}><RiDeleteBinLine /></Button>
            </> : null}
          </div>
          {!isCollapsed ? <div className="xe:border-t xe:border-border xe:px-4 xe:py-4">
            <FormRenderer fields={described.fields} data={row} path={rowPath} errors={props.errors} disabled={disabled}
              onChange={(name, next) => update(rows.map((r) => (r.id === row.id ? { ...r, [name]: next } : r)))} />
          </div> : null}
        </li>;
      })}
    </ol>
    {!disabled ? <div>{props.addControl((row) => update([...rows, row]), atMax)}</div> : null}
  </div>;
}

export function ArrayField(props: FieldInputProps) {
  const noun = props.field.labels?.singular ?? "Item";
  return <RowList {...props}
    describe={() => ({ fields: props.field.fields ?? [], noun })}
    emptyText={`No ${(props.field.labels?.plural ?? "items").toLowerCase()} yet.`}
    addControl={(add, atMax) => <Button type="button" variant="outline" size="sm" disabled={atMax} onClick={() => add(newArrayRow(props.field) as Row)}>
      <RiAddLine data-icon="inline-start" />Add {noun.toLowerCase()}
    </Button>} />;
}

export function BlocksField(props: FieldInputProps) {
  const blocks = props.field.blocks ?? [];
  const bySlug = new Map<string, ClientBlock>(blocks.map((b) => [b.slug, b]));
  return <RowList {...props}
    describe={(row) => {
      const block = typeof row.blockType === "string" ? bySlug.get(row.blockType) : undefined;
      return block ? { fields: block.fields, noun: block.labels.singular } : null;
    }}
    emptyText="No blocks yet."
    addControl={(add, atMax) => blocks.length === 1
      ? <Button type="button" variant="outline" size="sm" disabled={atMax} onClick={() => add(newBlock(blocks[0]!) as Row)}>
        <RiAddLine data-icon="inline-start" />Add {blocks[0]!.labels.singular.toLowerCase()}
      </Button>
      : <DropdownMenu>
        <DropdownMenuTrigger disabled={atMax} render={<Button type="button" variant="outline" size="sm" />}>
          <RiAddLine data-icon="inline-start" />Add block<RiArrowDownSLine data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            {blocks.map((block) => <DropdownMenuItem key={block.slug} onClick={() => add(newBlock(block) as Row)}>
              <span className="xe:flex xe:flex-col">
                <span>{block.labels.singular}</span>
                {block.description ? <span className="xe:text-xs xe:text-muted-foreground">{block.description}</span> : null}
              </span>
            </DropdownMenuItem>)}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>} />;
}
