import { defineCollection, defineConfig, text } from "../src/index";
import type { DeleteHookArgs } from "../src/index";
import type { XenonInstance } from "../src/server/types";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
    : false;
type Expect<T extends true> = T;

export const posts = defineCollection({
  slug: "posts",
  trash: true,
  fields: { title: text({ required: true }), summary: text() },
  hooks: {
    afterDelete: ({ permanent }) => {
      type _permanent = Expect<Equal<typeof permanent, boolean>>;
    },
  },
});
// @ts-expect-error - trash is a boolean
defineCollection({ slug: "x", trash: "yes", fields: { t: text() } });

const config = defineConfig({ collections: [posts] });
declare const xenon: XenonInstance<typeof config>;

export async function usage() {
  const bin = await xenon.find({ collection: "posts", trash: true });
  type _bin = Expect<Equal<typeof bin.docs[number]["title"], string>>;
  const one = await xenon.findById({ collection: "posts", id: "1", trash: true });
  type _one = Expect<Equal<NonNullable<typeof one>["title"], string>>;
  const restored = await xenon.restore({ collection: "posts", id: "1" });
  type _restored = Expect<Equal<typeof restored.title, string>>;
  await xenon.purge({ collection: "posts", id: "1" });
  const copy = await xenon.duplicate({ collection: "posts", id: "1", data: { title: "Copy" } });
  type _copy = Expect<Equal<typeof copy.summary, string | null | undefined>>;
  // @ts-expect-error - overrides are typed from the fields
  await xenon.duplicate({ collection: "posts", id: "1", data: { title: 5 } });
}

export type _args = DeleteHookArgs<{ id: string }>["permanent"];
