import { nextjsTemplate } from "./nextjs";
import type { FrameworkTemplate, ProjectContext } from "./types";

/**
 * Registered `xenon-cms init` framework templates.
 * Next.js App Router ships first; framework-agnostic Fetch/Hono and additional host adapters
 * (Astro, TanStack Start, React Router) register here as `xenon-cms/http` (#8) and adapters land.
 */
export const TEMPLATES: readonly FrameworkTemplate[] = [nextjsTemplate];

export function getTemplate(
  id: string,
  templates: readonly FrameworkTemplate[] = TEMPLATES,
): FrameworkTemplate | undefined {
  const normalized = id.trim().toLowerCase();
  if (normalized === "nextjs" || normalized === "next.js") {
    return templates.find((t) => t.id === "next");
  }
  return templates.find((t) => t.id === normalized);
}

export function detectTemplate(
  ctx: ProjectContext,
  templates: readonly FrameworkTemplate[] = TEMPLATES,
): FrameworkTemplate {
  let best = templates[0]!;
  let bestScore = -1;
  for (const template of templates) {
    const score = template.detect(ctx);
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return best;
}

export function listTemplateIds(templates: readonly FrameworkTemplate[] = TEMPLATES): string[] {
  return templates.map((t) => t.id);
}
