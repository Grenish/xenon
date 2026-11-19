"use client";

import { Children, isValidElement, type ReactNode } from "react";
import { TabList, useTabIds } from "./tab-list";
import { useSyncedChoice } from "./synced";

/**
 * `<Tabs items={["App Router", "Pages"]}>` with one `<Tab>` per item, in order. Groups with the same items stay in
 * step across the site. Every pane is in the HTML (hidden, not removed), so search and find-in-page reach them.
 */
export function Tabs({ items, children }: { items: string[]; children: ReactNode }) {
  const [value, setValue] = useSyncedChoice(`tabs:${items.join("|")}`, items);
  const ids = useTabIds();
  const panes = Children.toArray(children).filter(isValidElement);
  return (
    <div className="docs-tabs docs-tabs--panes">
      <TabList items={items} value={value} onChange={setValue} label={items.join(" or ")} idBase={ids} />
      {panes.map((pane, i) => {
        const it = items[i];
        if (!it) return null;
        return (
          <div key={it} role="tabpanel" id={`${ids}-panel-${it}`} aria-labelledby={`${ids}-tab-${it}`} hidden={it !== value} className="docs-tabs__pane">
            {pane}
          </div>
        );
      })}
    </div>
  );
}

export function Tab({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
