import { Extension, type Editor, type Range } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import type { ComponentType } from "react";

/*
 * "/" command menu. The Tiptap side (this file) only tracks state; a React component renders the
 * menu from `SlashMenuStore` inside the admin's portal container so it picks up theme tokens.
 */

export interface SlashItem {
  id: string;
  title: string;
  description: string;
  group: "Basic blocks" | "Lists" | "Media";
  keywords: string[];
  icon: ComponentType<{ className?: string }>;
  /** Runs after the "/query" text has been removed. */
  run(editor: Editor): void;
}

export interface SlashMenuState {
  open: boolean;
  items: SlashItem[];
  active: number;
  rect: DOMRect | null;
}

const CLOSED: SlashMenuState = { open: false, items: [], active: 0, rect: null };

export class SlashMenuStore {
  private state: SlashMenuState = CLOSED;
  private listeners = new Set<() => void>();
  private select: ((item: SlashItem) => void) | null = null;

  constructor(public items: () => SlashItem[]) {}

  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  private set(next: Partial<SlashMenuState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  filter(query: string): SlashItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((item) => [item.title, ...item.keywords].some((word) => word.toLowerCase().includes(q)));
  }

  update(props: SuggestionProps<SlashItem, SlashItem>) {
    this.select = (item) => props.command(item);
    const rect = props.clientRect?.() ?? null;
    const sameItems = props.items.length === this.state.items.length && props.items.every((item, i) => item === this.state.items[i]);
    this.set({ open: true, items: props.items, rect, active: sameItems ? this.state.active : 0 });
  }
  close() {
    this.select = null;
    this.set(CLOSED);
  }
  choose(index: number) {
    const item = this.state.items[index];
    if (item) this.select?.(item);
  }
  setActive(index: number) {
    if (index !== this.state.active) this.set({ active: index });
  }

  keyDown({ event }: SuggestionKeyDownProps): boolean {
    if (!this.state.open) return false;
    const count = this.state.items.length;
    if (event.key === "Escape") {
      this.close();
      return true;
    }
    if (!count) return false;
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      this.setActive((this.state.active + 1) % count);
      return true;
    }
    if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      this.setActive((this.state.active - 1 + count) % count);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      this.choose(this.state.active);
      return true;
    }
    return false;
  }
}

export const slashPluginKey = new PluginKey("xenonSlashCommand");

export const SlashCommand = Extension.create<{ store: SlashMenuStore | null }>({
  name: "slashCommand",
  addOptions() {
    return { store: null };
  },
  addProseMirrorPlugins() {
    const store = this.options.store;
    if (!store) return [];
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashPluginKey,
        char: "/",
        allowSpaces: false,
        decorationClass: "xe-slash-query",
        // Not inside code blocks, where "/" is just a character.
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => store.filter(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => ({
          onStart: (props) => store.update(props),
          onUpdate: (props) => store.update(props),
          onKeyDown: (props) => store.keyDown(props),
          onExit: () => store.close(),
        }),
      }),
    ];
  },
});
