/**
 * Preview-only plumbing: which design version to show and which data state to simulate.
 * Set by the floating switcher (cookies), so links between pages keep the choice.
 * Not part of the starter itself.
 */
import { cookies } from "next/headers";
import type { PostCard, Setup } from "./data";

import { STATES, STATE_COOKIE, VARIANTS, VARIANT_COOKIE, type PreviewState, type Variant } from "./preview-shared";

export { STATES, VARIANTS, type PreviewState, type Variant };

export async function readPreview(): Promise<{ variant: Variant; state: PreviewState }> {
  const jar = await cookies();
  const v = jar.get(VARIANT_COOKIE)?.value;
  const s = jar.get(STATE_COOKIE)?.value;
  return {
    variant: VARIANTS.some((x) => x.id === v) ? (v as Variant) : "sheet",
    state: STATES.some((x) => x.id === s) ? (s as PreviewState) : "live",
  };
}

/** Applies a simulated state on top of the live data. */
export function simulate(state: PreviewState, posts: PostCard[], setup: Setup): { posts: PostCard[]; setup: Setup } {
  if (state === "fresh") return { posts: [], setup: { hasAdmin: false, hasPosts: false } };
  if (state === "account") return { posts: [], setup: { hasAdmin: true, hasPosts: false } };
  return { posts, setup };
}
