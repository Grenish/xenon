import { nextCookies } from "better-auth/next-js";
import { revalidateTag } from "next/cache";
import type { XenonConfig } from "../core/types";
import type { XenonInstance } from "../server/types";
import { createXenon } from "../server/xenon";

/** Cache tags used by Xenon. Use with `cacheTag()` inside `"use cache"` functions. */
export const xenonTags = {
  all: "xenon",
  collection: (collection: string) => `xenon:${collection}`,
  doc: (collection: string, id: string) => `xenon:${collection}:${id}`,
} as const;

const instances = new WeakMap<XenonConfig, XenonInstance<XenonConfig>>();

/**
 * Memoized Local API for Next.js: wires BetterAuth cookies into server actions and expires
 * Xenon cache tags after every write. Draft-only saves leave live content unchanged, so they
 * expire just the document's own tag instead of the site-wide and collection tags.
 */
export function getXenon<Cfg extends XenonConfig>(config: Cfg): XenonInstance<Cfg> {
  let xenon = instances.get(config);
  if (!xenon) {
    xenon = createXenon(config, {
      authPlugins: [nextCookies()],
      onChange: ({ collection, id, draft }) => {
        const tags = draft
          ? [xenonTags.doc(collection, id)]
          : [xenonTags.all, xenonTags.collection(collection), xenonTags.doc(collection, id)];
        for (const tag of tags) {
          try {
            revalidateTag(tag, { expire: 0 });
          } catch {
            // Outside a Next.js request scope (scripts, tests) there is nothing to revalidate.
          }
        }
      },
    });
    instances.set(config, xenon);
  }
  return xenon as XenonInstance<Cfg>;
}
