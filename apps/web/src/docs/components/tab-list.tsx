"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

/** The row of tabs over a code block or a group of panes; arrow keys move between them. */
export function TabList({
  items,
  value,
  onChange,
  label,
  idBase,
  end,
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  idBase: string;
  end?: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const i = items.indexOf(value);
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = items[(to + items.length) % items.length]!;
    onChange(next);
    row.current?.querySelector<HTMLButtonElement>(`[data-tab="${CSS.escape(next)}"]`)?.focus();
  };
  return (
    <div className="docs-tabs__bar">
      <div ref={row} role="tablist" aria-label={label} className="flex min-w-0 overflow-x-auto" onKeyDown={onKey}>
        {items.map((it) => (
          <button
            key={it}
            type="button"
            role="tab"
            id={`${idBase}-tab-${it}`}
            aria-controls={`${idBase}-panel-${it}`}
            aria-selected={it === value}
            tabIndex={it === value ? 0 : -1}
            data-tab={it}
            onClick={() => onChange(it)}
            className="docs-tabs__tab"
          >
            {it}
          </button>
        ))}
      </div>
      {end}
    </div>
  );
}

export const useTabIds = () => useId().replace(/:/g, "");
