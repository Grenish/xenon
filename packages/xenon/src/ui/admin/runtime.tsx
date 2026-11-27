"use client";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import type { AdminActionInput, AdminActionResult } from "../../http/admin-action";
import type { AdminRouteData } from "../../http/admin-loader";
import { toPlainJson } from "../shared/plain";
import { useAdminRouter } from "../shared/router";
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
  presignedUploads: boolean;
}

const RuntimeContext = createContext<RuntimeValue | null>(null);

export function useAdminRuntime(): RuntimeValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("[xenon] useAdminRuntime() must be used inside <AdminRoot>.");
  return ctx;
}

const NETWORK_ERROR = { ok: false, error: { code: "NETWORK", message: "Can't reach the server. Check your connection and try again." } } as const;

/**
 * Default HTTP admin action transport (`POST {apiPath}/_admin/action`).
 * Used automatically when no host Server Action is supplied to `<AdminRoot>`.
 */
export function createHttpAdminAction(apiPath: string): AdminAction {
  const base = apiPath.replace(/\/+$/, "");
  return async (input: AdminActionInput): Promise<AdminActionResult> => {
    let res: Response;
    try {
      res = await fetch(`${base}/_admin/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toPlainJson(input)),
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      return NETWORK_ERROR;
    }
    const json = (await res.json().catch(() => null)) as
      | AdminActionResult
      | { errors?: { message: string; path?: (string | number)[] }[] }
      | null;
    if (json && typeof json === "object" && "ok" in json && typeof json.ok === "boolean") {
      return json;
    }
    const errors = json && "errors" in json && Array.isArray(json.errors) ? json.errors : [];
    return {
      ok: false,
      error: {
        code: String(res.status),
        message: errors[0]?.message ?? "Request failed. Please try again.",
        issues: errors.map((e) => ({ path: e.path ?? [], message: e.message })),
      },
    };
  };
}

/** Fetches the server-loaded admin route payload from `GET {apiPath}/_admin/data`. */
export async function fetchAdminData(apiPath: string, path?: string, search?: string): Promise<AdminRouteData> {
  const base = apiPath.replace(/\/+$/, "");
  const params = new URLSearchParams(search?.startsWith("?") ? search.slice(1) : search);
  if (path !== undefined) params.set("path", path);
  const qs = params.toString();
  const res = await fetch(`${base}/_admin/data${qs ? `?${qs}` : ""}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  return (await res.json()) as AdminRouteData;
}

export function AdminRuntimeProvider(props: {
  basePath: string;
  apiPath: string;
  /** Optional custom transport (e.g. Next.js Server Action). Defaults to HTTP `POST {apiPath}/_admin/action`. */
  action?: AdminAction;
  theme: AdminTheme;
  /** `true` when the configured storage adapter supports direct presigned uploads. */
  presignedUploads?: boolean;
  children: ReactNode;
}) {
  const router = useAdminRouter();
  const theme = useAdminTheme(props.theme);
  const presignedUploads = props.presignedUploads === true;
  const action = useMemo<AdminAction>(
    () => props.action ?? createHttpAdminAction(props.apiPath),
    [props.action, props.apiPath],
  );

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
    () => ({ basePath: props.basePath, apiPath: props.apiPath, action, run, theme, setTheme, presignedUploads }),
    [props.basePath, props.apiPath, action, run, theme, setTheme, presignedUploads],
  );
  return <RuntimeContext.Provider value={value}>{props.children}</RuntimeContext.Provider>;
}

interface HttpErrorPayload {
  errors?: { message: string; path?: (string | number)[] }[];
}

function toHttpError(status: number, json: HttpErrorPayload | null, fallback = "Upload failed."): ActionResult<never> {
  const errors = json?.errors ?? [];
  return {
    ok: false,
    error: {
      code: status === 409 && errors.some((e) => e.path?.[0] === "updatedAt") ? "CONFLICT" : String(status),
      message: errors[0]?.message ?? fallback,
      issues: errors.map((e) => ({ path: e.path ?? [], message: e.message })),
    },
  };
}

/** Builds the `AdminServices` used by feature components from the runtime. */
export function useServices(): AdminServices {
  const { run, apiPath, presignedUploads } = useAdminRuntime();
  const router = useAdminRouter();
  return useMemo<AdminServices>(
    () => ({
      save: (input) => run<AdminDoc>({ type: "doc.save", ...input }, { refresh: true }),
      unpublish: (input) => run<AdminDoc>({ type: "doc.unpublish", ...input }, { refresh: true }),
      remove: (input) => run<{ id: string }>({ type: "doc.remove", ...input }, { refresh: true }),
      get: (input) => run<AdminDoc>({ type: "doc.get", ...input }),
      search: (input) => run<SearchResult>({ type: "doc.search", ...input }),
      saveGlobal: (input) => run<AdminDoc>({ type: "global.save", ...input }, { refresh: true }),
      getGlobal: (input) => run<AdminDoc | null>({ type: "global.get", ...input }),
      unpublishGlobal: (input) => run<AdminDoc>({ type: "global.unpublish", ...input }, { refresh: true }),
      async upload({ collection, id, file, data, expectedUpdatedAt }) {
        const base = `${apiPath.replace(/\/+$/, "")}/${encodeURIComponent(collection)}`;
        const ifMatch = id && expectedUpdatedAt ? { "if-match": `"${expectedUpdatedAt}"` } : undefined;
        let savedId: string | undefined;

        if (presignedUploads) {
          // 1. Mint a short-lived presigned URL + signed completion token.
          let presignRes: Response;
          try {
            presignRes = await fetch(`${base}/_presign`, {
              method: "POST",
              headers: { "content-type": "application/json", ...ifMatch },
              body: JSON.stringify({
                filename: file.name,
                mimeType: file.type || "application/octet-stream",
                size: file.size,
                ...(id ? { id } : {}),
              }),
              credentials: "same-origin",
              cache: "no-store",
            });
          } catch {
            return NETWORK_ERROR;
          }
          const presignJson = (await presignRes.json().catch(() => null)) as
            | ({
                key?: string;
                token?: string;
                upload?: { url: string; method: "PUT" | "POST"; headers: Record<string, string> };
              } & HttpErrorPayload)
            | null;
          if (!presignRes.ok || !presignJson?.token || !presignJson?.upload?.url) {
            return toHttpError(presignRes.status, presignJson);
          }

          // 2. Upload bytes directly from the browser to S3/R2 (credentials omitted for cross-origin CORS).
          let putRes: Response;
          try {
            putRes = await fetch(presignJson.upload.url, {
              method: presignJson.upload.method,
              headers: presignJson.upload.headers,
              body: file,
              credentials: "omit",
            });
          } catch {
            return {
              ok: false,
              error: {
                code: "UPLOAD_FAILED",
                message: "Direct upload to storage failed. Check your connection or storage CORS configuration and try again.",
              },
            };
          }
          if (!putRes.ok) {
            return {
              ok: false,
              error: {
                code: String(putRes.status),
                message: `Direct upload to storage failed (${putRes.status}).`,
              },
            };
          }

          // 3. Complete the upload (server runs HEAD + Range GET security/dimension verification before saving).
          let completeRes: Response;
          try {
            completeRes = await fetch(`${base}/_complete`, {
              method: "POST",
              headers: { "content-type": "application/json", ...ifMatch },
              body: JSON.stringify({
                token: presignJson.token,
                key: presignJson.key,
                data,
                ...(id ? { id } : {}),
              }),
              credentials: "same-origin",
              cache: "no-store",
            });
          } catch {
            return NETWORK_ERROR;
          }
          const completeJson = (await completeRes.json().catch(() => null)) as ({ id?: string } & HttpErrorPayload) | null;
          if (!completeRes.ok || !completeJson?.id) {
            return toHttpError(completeRes.status, completeJson);
          }
          savedId = completeJson.id;
        } else {
          // Local storage / non-presigned adapters: multipart REST upload avoids the Server Action body limit.
          const body = new FormData();
          body.set("file", file);
          body.set("data", JSON.stringify(data));
          let res: Response;
          try {
            res = await fetch(`${base}${id ? `/${encodeURIComponent(id)}` : ""}`, {
              method: id ? "PATCH" : "POST",
              body,
              headers: ifMatch,
              credentials: "same-origin",
            });
          } catch {
            return NETWORK_ERROR;
          }
          const json = (await res.json().catch(() => null)) as ({ id?: string } & HttpErrorPayload) | null;
          if (!res.ok || !json?.id) {
            return toHttpError(res.status, json);
          }
          savedId = json.id;
        }

        const doc = await run<AdminDoc>({ type: "doc.get", collection, id: savedId });
        if (doc.ok) router.refresh();
        return doc;
      },
    }),
    [run, apiPath, presignedUploads, router],
  );
}
