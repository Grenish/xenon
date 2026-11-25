"use client";

import { useRef, useState } from "react";
import { RiPencilLine } from "@remixicon/react";
import { slugify } from "../../core/slug";
import { Button } from "../components/button";
import { Input } from "../components/input";

export interface SlugEditorProps {
  /** The slug as saved (draft view: includes a pending change). */
  saved: string | null;
  /** The slug currently live, when the document is published. */
  live: string | null;
  published: boolean;
  /** The saved slug was set by hand. */
  manual: boolean;
  /** Unsaved edit: a string sets it by hand, `null` = back to automatic, `undefined` = no edit. */
  edit: string | null | undefined;
  /** Value of the `slugFrom` field (for the automatic preview), or `null` without `slugFrom`. */
  automaticFrom: string | null;
  disabled?: boolean;
  onEdit(next: string | null | undefined): void;
}

/** The Slug row of the Publishing panel: shows the slug and lets editors set it by hand. */
export function SlugEditor(props: SlugEditorProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hasAutomatic = props.automaticFrom !== null;
  const automatic = props.automaticFrom ? slugify(props.automaticFrom) : "";
  // What the slug will be after the next save.
  const shown = props.edit === undefined ? props.saved ?? (automatic || null) : props.edit === null ? automatic || props.saved : slugify(props.edit);
  const isManual = props.edit === undefined ? props.manual : props.edit !== null;
  const changesLive = props.published && props.live !== null && shown !== null && shown !== props.live;
  const normalized = slugify(text);

  function open() {
    setText(shown ?? automatic);
    setEditing(true);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }
  function apply() {
    if (!normalized) return;
    props.onEdit(normalized === props.saved && props.manual ? undefined : normalized);
    setEditing(false);
  }

  if (editing) {
    return <div className="xe:flex xe:flex-col xe:gap-2">
      <label htmlFor="xe-slug-input" className="xe:text-muted-foreground">Slug</label>
      <Input id="xe-slug-input" ref={inputRef} value={text} spellCheck={false} autoComplete="off" className="xe:h-8 xe:font-mono xe:text-xs"
        aria-describedby="xe-slug-help" aria-invalid={!normalized}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); apply(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(false); }
        }} />
      <p id="xe-slug-help" className="xe:text-xs xe:text-muted-foreground">
        {!normalized ? "Use at least one letter or number." : normalized !== text ? <>Saved as <code className="xe:font-mono">{normalized}</code></> : props.published ? "The live URL changes when you publish." : "Must be unique in this collection."}
      </p>
      <div className="xe:flex xe:flex-wrap xe:items-center xe:gap-1.5">
        <Button type="button" size="xs" disabled={!normalized} onClick={apply}>Apply</Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        {hasAutomatic && isManual ? <Button type="button" size="xs" variant="ghost" className="xe:ml-auto"
          onClick={() => { props.onEdit(props.manual ? null : undefined); setEditing(false); }}>Use automatic</Button> : null}
      </div>
    </div>;
  }

  return <div className="xe:flex xe:flex-col xe:gap-1">
    <div className="xe:flex xe:items-center xe:justify-between xe:gap-2">
      <dt className="xe:shrink-0 xe:text-muted-foreground">Slug</dt>
      <dd className="xe:flex xe:min-w-0 xe:items-center xe:gap-1">
        <span className="xe:min-w-0 xe:truncate xe:font-mono xe:text-xs" title={shown ?? undefined}>
          {shown ?? <span className="xe:font-sans xe:text-muted-foreground">Set when you save</span>}
        </span>
        {!props.disabled ? <Button type="button" variant="ghost" size="icon-xs" aria-label="Edit slug" onClick={open}><RiPencilLine /></Button> : null}
      </dd>
    </div>
    {changesLive ? <p className="xe:text-xs xe:text-muted-foreground">Live at <code className="xe:font-mono">{props.live}</code> until you publish.</p> : null}
  </div>;
}
