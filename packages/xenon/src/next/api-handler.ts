import type { XenonConfig } from "../core/types";
import { extractRouteSegments, handleApiSegments } from "../http/handler";
import type { XenonInstance } from "../server/types";
import { disableNextDraftMode, enableNextDraftMode } from "./preview";
import { getXenon } from "./xenon";

export interface RouteContext {
  params: Promise<{ slug: string[] }>;
}

/**
 * Catch-all Next.js App Router REST handlers (`app/api/xenon/[...slug]/route.ts`).
 * Thin backwards-compatible wrapper over `xenon-cms/http` wired to `getXenon(config)`
 * (`nextCookies()` + `revalidateTag()`).
 */
export function createApiHandler<Cfg extends XenonConfig>(
  config: Cfg,
  options?: { xenon?: XenonInstance<Cfg>; cacheControl?: string },
) {
  const xenon = (options?.xenon ?? getXenon(config)) as XenonInstance;

  async function handle(request: Request, context?: RouteContext): Promise<Response> {
    let segments: string[] | null;
    if (context?.params) {
      const { slug } = await context.params;
      segments = slug ?? [];
    } else {
      segments = extractRouteSegments(new URL(request.url).pathname, config.api.path);
    }
    if (segments === null) {
      return Response.json({ errors: [{ message: "Route not found." }] }, { status: 404 });
    }
    const response = await handleApiSegments(request, segments, config, xenon, { cacheControl: options?.cacheControl });
    if (segments[0] === "_preview") {
      if (segments.length === 1 && request.method === "GET" && response.status >= 300 && response.status < 400) {
        await enableNextDraftMode();
      } else if (segments.length === 2 && segments[1] === "exit" && response.status < 400) {
        await disableNextDraftMode();
      }
    }
    return response;
  }

  return { GET: handle, POST: handle, PATCH: handle, DELETE: handle };
}
