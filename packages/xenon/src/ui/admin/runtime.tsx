"use client";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import type { AdminActionInput, AdminActionResult } from "../../next/admin/action";
import { toPlainJson } from "../shared/plain";
import type { ActionResult, AdminDoc, AdminServices, SearchResult } from "../shared/services";

import { type AdminTheme, themeStore, useAdminTheme } from "./theme-store";

export type { AdminTheme };
export type AdminAction = (input: AdminActionInput) => Promise<AdminActionResult>;

interface RuntimeValue {
  basePath: string;
  apiPath: string;
  action: AdminAction;
  /** Runs an action; refreshes server data after successful mutations. */
  run<T>(input: AdminActionInput, options?: { refresh?: boolean }): Promise<ActionResult<T>>;
  theme: AdminTheme;
  setTheme(theme: AdminTheme): void;
}

const RuntimeContext = createContext<RuntimeValue | null>(null);

export function useAdminRuntime(): RuntimeValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("[xenon] useAdminRuntime() must be used inside <AdminRoot>.");
  return ctx;
}

const NETWORK_ERROR = { ok: false, error: { code: "NETWORK", message: "Can't reach the server. Check your connection and try again." } } as const;

export function AdminRuntimeProvider(props: {
  basePath: string;
  apiPath: string;
  action: AdminAction;
  theme: AdminTheme;
  children: ReactNode;
}) {
  const router = useRouter();
  const theme = useAdminTheme(props.theme);
  const { action } = props;

  const run = useCallback(
    async <T,>(input: AdminActionInput, options?: { refresh?: boolean }): Promise<ActionResult<T>> => {
      try {
        // Action inputs must be plain JSON: React drops null-prototype objects (e.g. Tiptap node attrs).
        const result = (await action(toPlainJson(input))) as ActionResult<T>;
        if (result.ok && options?.refresh) router.refresh();
        return result;
      } catch {
        return NETWORK_ERROR;
      }
    },
    [action, router],
  );

  const setTheme = useCallback((next: AdminTheme) => themeStore.set(next), []);

  const value = useMemo<RuntimeValue>(
    () => ({ basePath: props.basePath, apiPath: props.apiPath, action, run, theme, setTheme }),
    [props.basePath, props.apiPath, action, run, theme, setTheme],
  );
  return <RuntimeContext.Provider value={value}>{props.children}</RuntimeContext.Provider>;
}

/** Builds the `AdminServices` used by feature components from the runtime. */
export function useServices(): AdminServices {
  const { run, apiPath } = useAdminRuntime();
  const router = useRouter();
  return useMemo<AdminServices>(
    () => ({
      save: (input) => run<AdminDoc>({ type: "doc.save", ...input }, { refresh: true }),
      unpublish: (input) => run<AdminDoc>({ type: "doc.unpublish", ...input }, { refresh: true }),
      remove: (input) => run<{ id: string }>({ type: "doc.remove", ...input }, { refresh: true }),
      get: (input) => run<AdminDoc>({ type: "doc.get", ...input }),
      search: (input) => run<SearchResult>({ type: "doc.search", ...input }),
      async upload({ collection, id, file, data, expectedUpdatedAt }) {
        // Files go through the REST API (multipart) to avoid the Server Action body size limit.
        const body = new FormData();
        body.set("file", file);
        body.set("data", JSON.stringify(data));
        let res: Response;
        try {
          res = await fetch(`${apiPath}/${encodeURIComponent(collection)}${id ? `/${encodeURIComponent(id)}` : ""}`, {
            method: id ? "PATCH" : "POST",
            body,
            headers: id && expectedUpdatedAt ? { "if-match": `"${expectedUpdatedAt}"` } : undefined,
            credentials: "same-origin",
          });
        } catch {
          return NETWORK_ERROR;
        }
        const json = (await res.json().catch(() => null)) as
          | { id?: string; errors?: { message: string; path?: (string | number)[] }[] }
          | null;
        if (!res.ok || !json?.id) {
          const errors = json?.errors ?? [];
          return {
            ok: false,
            error: {
              code: res.status === 409 && errors.some((e) => e.path?.[0] === "updatedAt") ? "CONFLICT" : String(res.status),
              message: errors[0]?.message ?? "Upload failed.",
              issues: errors.map((e) => ({ path: e.path ?? [], message: e.message })),
            },
          };
        }
        const doc = await run<AdminDoc>({ type: "doc.get", collection, id: json.id });
        if (doc.ok) router.refresh();
        return doc;
      },
    }),
    [run, apiPath, router],
  );
}
