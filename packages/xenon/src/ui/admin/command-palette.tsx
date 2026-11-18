"use client";
import {
  RiAddLine,
  RiArrowRightLine,
  RiComputerLine,
  RiCornerDownLeftLine,
  RiDashboardLine,
  RiMoonLine,
  RiSearchLine,
  RiSunLine,
  RiTeamLine,
  RiPaletteLine,
  RiSettings3Line,
} from "@remixicon/react";
import { useRouter } from "next/navigation";
import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "../components/dialog";
import { Kbd } from "../components/kbd";
import { Spinner } from "../components/spinner";
import { cn } from "../lib/utils";
import { useAdmin } from "../shared/admin-context";
import { adminRoutes, type DocSummary } from "../shared/services";
import { StatusBadge } from "./format";
import { useAdminRuntime } from "./runtime";
import { collectionIcon } from "./shell";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  status?: DocSummary["status"];
  run(): void;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** ⌘K: jump anywhere, create documents, search content across collections. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { basePath, collections, user, services } = useAdmin();
  const { setTheme } = useAdminRuntime();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(query.trim(), 200);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  const go = (href: string) => () => {
    onOpenChange(false);
    router.push(href);
  };

  const staticItems = useMemo<Item[]>(() => {
    const items: Item[] = [{ id: "nav:dashboard", group: "Go to", label: "Dashboard", icon: RiDashboardLine, run: go(adminRoutes.dashboard(basePath)) }];
    for (const c of collections) {
      items.push({ id: `nav:${c.slug}`, group: "Go to", label: c.labels.plural, icon: collectionIcon(c), run: go(adminRoutes.list(basePath, c.slug)) });
    }
    if (user.role === "admin") items.push({ id: "nav:users", group: "Go to", label: "Team", icon: RiTeamLine, run: go(adminRoutes.users(basePath)) });
    items.push({ id: "nav:settings", group: "Go to", label: "Settings", icon: RiSettings3Line, run: go(adminRoutes.settings(basePath)) });
    items.push({ id: "nav:appearance", group: "Go to", label: "Appearance settings", icon: RiPaletteLine, run: go(adminRoutes.settings(basePath, "appearance")) });
    for (const c of collections) {
      items.push({ id: `new:${c.slug}`, group: "Create", label: `New ${c.labels.singular.toLowerCase()}`, icon: RiAddLine, run: go(adminRoutes.create(basePath, c.slug)) });
    }
    const theme = (t: "light" | "dark" | "system") => () => {
      setTheme(t);
      onOpenChange(false);
    };
    items.push(
      { id: "theme:light", group: "Appearance", label: "Light theme", icon: RiSunLine, run: theme("light") },
      { id: "theme:dark", group: "Appearance", label: "Dark theme", icon: RiMoonLine, run: theme("dark") },
      { id: "theme:system", group: "Appearance", label: "Match system theme", icon: RiComputerLine, run: theme("system") },
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, collections, user.role]);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      collections.map(async (c) => {
        const res = await services.search({ collection: c.slug, query: debounced, limit: 5 });
        if (!res.ok) return [] as Item[];
        return res.data.docs.map<Item>((d) => ({
          id: `doc:${c.slug}:${d.id}`,
          group: c.labels.plural,
          label: d.title,
          icon: collectionIcon(c),
          status: d.status,
          run: () => {
            onOpenChange(false);
            router.push(adminRoutes.edit(basePath, c.slug, d.id));
          },
        }));
      }),
    ).then((groups) => {
      if (cancelled) return;
      setResults(groups.flat());
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, collections, services, basePath, router, onOpenChange]);

  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const matched = q ? staticItems.filter((i) => i.label.toLowerCase().includes(q)) : staticItems;
    return [...results, ...matched];
  }, [q, staticItems, results]);

  useEffect(() => setActive(0), [q, results.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  }

  let lastGroup = "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="xe:top-[18%] xe:translate-y-0 xe:gap-0 xe:overflow-hidden xe:p-0 xe:sm:max-w-xl">
        <DialogTitle className="xe:sr-only">Search and commands</DialogTitle>
        <div className="xe:flex xe:items-center xe:gap-2.5 xe:border-b xe:border-border xe:px-4">
          {loading ? <Spinner className="xe:size-4 xe:text-muted-foreground" /> : <RiSearchLine className="xe:size-4 xe:text-muted-foreground" />}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search content, pages and actions…"
            className="xe:h-12 xe:flex-1 xe:bg-transparent xe:text-[15px] xe:outline-none"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="xe-palette-list"
            aria-activedescendant={items[active] ? `xe-palette-${active}` : undefined}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="xe-palette-list" role="listbox" className="xe:max-h-[min(60vh,420px)] xe:overflow-y-auto xe:p-2">
          {items.length === 0 && (
            <p className="xe:px-3 xe:py-10 xe:text-center xe:text-sm xe:text-muted-foreground">{loading ? "Searching…" : "No results. Try a different word."}</p>
          )}
          {items.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={item.id}>
                {header && <p className="xe:px-3 xe:pb-1 xe:pt-3 xe:text-[11px] xe:font-semibold xe:uppercase xe:tracking-wider xe:text-muted-foreground xe:first:pt-1">{header}</p>}
                <button
                  type="button"
                  id={`xe-palette-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={item.run}
                  className={cn(
                    "xe:flex xe:h-10 xe:w-full xe:items-center xe:gap-3 xe:rounded-md xe:px-3 xe:text-left xe:text-sm xe:transition-colors",
                    index === active ? "xe:bg-accent xe:text-accent-foreground" : "xe:text-foreground",
                  )}
                >
                  <Icon className="xe:size-4 xe:shrink-0 xe:text-muted-foreground" />
                  <span className="xe:flex-1 xe:truncate">{item.label}</span>
                  {item.status && <StatusBadge status={item.status} />}
                  {index === active && (item.group.startsWith("Go") || item.status ? <RiArrowRightLine className="xe:size-4 xe:opacity-60" /> : <RiCornerDownLeftLine className="xe:size-4 xe:opacity-60" />)}
                </button>
              </div>
            );
          })}
        </div>
        <div className="xe:flex xe:items-center xe:gap-4 xe:border-t xe:border-border xe:bg-muted/40 xe:px-4 xe:py-2 xe:text-xs xe:text-muted-foreground">
          <span className="xe:flex xe:items-center xe:gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> to move</span>
          <span className="xe:flex xe:items-center xe:gap-1.5"><Kbd>↵</Kbd> to open</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
