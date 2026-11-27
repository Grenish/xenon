import { draftMode, headers as nextHeaders } from "next/headers";
import { resolveSecret } from "../auth";
import type { XenonConfig } from "../core/types";
import { PRIVATE_NO_STORE } from "../http/cache";
import {
  buildPreviewCookie,
  clearPreviewCookie,
  PREVIEW_SESSION_TTL_MS,
  resolvePreviewUrl,
  signPreviewToken,
  verifyPreviewRequest,
  verifyPreviewToken,
} from "../server/preview";

/** Enables Next.js `draftMode()` when inside a Next.js request scope; no-op outside Next.js. */
export async function enableNextDraftMode(): Promise<void> {
  try {
    (await draftMode()).enable();
  } catch {
    // Outside a Next.js request scope (e.g. unit tests calling handler directly).
  }
}

/** Disables Next.js `draftMode()` when inside a Next.js request scope; no-op outside Next.js. */
export async function disableNextDraftMode(): Promise<void> {
  try {
    (await draftMode()).disable();
  } catch {
    // Outside a Next.js request scope.
  }
}

/**
 * Checks whether the current Next.js Server Component / Route Handler is in Live Preview mode:
 * true when Next.js `draftMode()` is enabled OR a valid signed `xenon-preview` cookie is present.
 */
export async function isDraftPreview(config: XenonConfig, explicitHeaders?: Headers): Promise<boolean> {
  try {
    if ((await draftMode()).isEnabled) return true;
  } catch {
    // Outside a Next.js request scope; fall back to cookie verification.
  }
  let hdrs = explicitHeaders;
  if (!hdrs) {
    try {
      hdrs = await nextHeaders();
    } catch {
      return false;
    }
  }
  return (await verifyPreviewRequest(config, hdrs)) !== null;
}

/**
 * Optional standalone Next.js App Router preview route (`app/api/preview/route.ts`).
 * Note: `createApiHandler(config)` already enables/disables `draftMode()` automatically on
 * `/{api}/_preview` and `/{api}/_preview/exit`; mount this only if you want a custom route path.
 */
export function createPreviewHandler(config: XenonConfig) {
  async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const secure = url.protocol === "https:";
    const exit = url.searchParams.get("exit");
    if (exit === "1" || exit === "true") {
      await disableNextDraftMode();
      const target = url.searchParams.get("redirect") ?? "/";
      let location = "/";
      try {
        location = resolvePreviewUrl(target, config, request.url).url;
      } catch {
        return Response.json({ errors: [{ message: "Invalid redirect URL." }] }, { status: 400, headers: { "cache-control": PRIVATE_NO_STORE } });
      }
      const headers = new Headers({
        location,
        "cache-control": PRIVATE_NO_STORE,
        "set-cookie": clearPreviewCookie({ secure }),
      });
      return new Response(null, { status: 307, headers });
    }

    const token = url.searchParams.get("token");
    const secret = resolveSecret(config);
    const payload = await verifyPreviewToken(secret, token);
    if (!payload) {
      return Response.json(
        { errors: [{ message: "Invalid or expired preview token." }] },
        { status: 401, headers: { "cache-control": PRIVATE_NO_STORE } },
      );
    }
    let destination: string;
    try {
      destination = resolvePreviewUrl(payload.url, config, request.url).url;
    } catch {
      return Response.json(
        { errors: [{ message: "Invalid preview URL." }] },
        { status: 400, headers: { "cache-control": PRIVATE_NO_STORE } },
      );
    }
    const sessionToken = await signPreviewToken(
      secret,
      { kind: payload.kind, slug: payload.slug, id: payload.id, url: destination, userId: payload.userId },
      PREVIEW_SESSION_TTL_MS,
    );
    await enableNextDraftMode();
    const headers = new Headers({
      location: destination,
      "cache-control": PRIVATE_NO_STORE,
      "set-cookie": buildPreviewCookie(sessionToken, { secure }),
    });
    return new Response(null, { status: 307, headers });
  }

  async function POST(request: Request): Promise<Response> {
    const secure = new URL(request.url).protocol === "https:";
    await disableNextDraftMode();
    return Response.json(
      { ok: true },
      {
        status: 200,
        headers: {
          "cache-control": PRIVATE_NO_STORE,
          "set-cookie": clearPreviewCookie({ secure }),
        },
      },
    );
  }

  return { GET, POST };
}
