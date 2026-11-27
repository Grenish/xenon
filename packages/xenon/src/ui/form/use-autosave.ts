"use client";

import { useEffect, useRef } from "react";

/**
 * Debounced background save (#15): calls `run` once the editor has been dirty and unchanged for
 * `interval` ms. Every change in `deps` restarts the wait. `interval: null` turns it off.
 */
export function useAutosave({ interval, enabled, dirty, deps, run }: {
  interval: number | null;
  enabled: boolean;
  dirty: boolean;
  deps: readonly unknown[];
  run(): Promise<void>;
}): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (interval === null || !enabled || !dirty) return;
    const timer = setTimeout(() => void latest.current(), interval);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, enabled, dirty, ...deps]);
}
