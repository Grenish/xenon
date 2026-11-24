"use client";

/**
 * Module-level navigation guard for unsaved changes in `<DocumentEditor>`.
 *
 * `<CommandPalette>` and `<AdminShell>` live outside `<DocumentEditor>`, and Next.js App Router
 * has no built-in route-change blocker. When an editor is dirty it registers a blocker here so
 * programmatic navigation (`router.push`, sign-out) and browser Back/Forward go through the same
 * confirmation dialog instead of silently discarding edits.
 */
export interface DirtyBlocker {
  /** Ask the user whether to discard changes; calls `proceed(replace)` if confirmed. */
  confirm(proceed: (replace: boolean) => void): void;
}

let active: { id: number; blocker: DirtyBlocker } | null = null;
let nextId = 1;

export function registerDirtyBlocker(blocker: DirtyBlocker): () => void {
  const id = nextId++;
  active = { id, blocker };
  return () => {
    if (active?.id === id) active = null;
  };
}

export function hasDirtyBlocker(): boolean {
  return active !== null;
}

/**
 * Executes `proceed(false)` immediately when no editor is dirty; otherwise delegates to the active
 * editor's confirmation dialog (which passes `replace = true` when a Back sentinel was pushed) and
 * returns `false`.
 */
export function guardNavigation(proceed: (replace: boolean) => void): boolean {
  if (!active) {
    proceed(false);
    return true;
  }
  active.blocker.confirm(proceed);
  return false;
}
