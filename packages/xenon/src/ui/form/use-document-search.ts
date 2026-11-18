"use client";

import { useEffect, useState } from "react";
import { useAdmin } from "../shared/admin-context";
import type { SearchInput, SearchResult } from "../shared/services";

const empty: SearchResult = { docs: [], totalDocs: 0, page: 1, hasNextPage: false };

/** Debounce editor searches and ignore stale responses after input/collection changes. */
export function useDocumentSearch(input: SearchInput | null, delay = 200) {
  const { services } = useAdmin();
  const key = JSON.stringify(input);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ key: "", result: empty, loading: false, error: "" });
  useEffect(() => {
    if (key === "null") return;
    let active = true;
    const timer = setTimeout(async () => {
      setState((previous) => ({ ...previous, key, loading: true, error: "" }));
      try {
        const response = await services.search(JSON.parse(key) as SearchInput);
        if (active) setState({ key, result: response.ok ? response.data : empty, loading: false, error: response.ok ? "" : response.error.message });
      } catch {
        if (active) setState({ key, result: empty, loading: false, error: "Could not load items. Try again." });
      }
    }, delay);
    return () => { active = false; clearTimeout(timer); };
  }, [key, delay, services, reload]);
  return {
    result: key === "null" || state.key !== key ? empty : state.result,
    loading: key !== "null" && (state.key !== key || state.loading),
    error: state.key === key ? state.error : "",
    reload: () => setReload((value) => value + 1),
  };
}
