import { defineCollection, defineConfig, text } from "../src/index";
import type { DocumentSchedule, DocumentVersion, ScheduledRunResult, XenonInstance } from "../src/server/types";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
    : false;
type Expect<T extends true> = T;

export const posts = defineCollection({
  slug: "posts",
  versions: { max: 20 },
  admin: { autosave: { interval: 1500 } },
  fields: { title: text({ required: true }) },
});
defineCollection({ slug: "a", versions: true, admin: { autosave: true }, fields: { t: text() } });
// @ts-expect-error - versions takes `max`
defineCollection({ slug: "b", versions: { keep: 3 }, fields: { t: text() } });
// @ts-expect-error - autosave takes `interval`
defineCollection({ slug: "c", admin: { autosave: { delay: 3 } }, fields: { t: text() } });

const config = defineConfig({ collections: [posts] });
declare const xenon: XenonInstance<typeof config>;

export async function usage() {
  const versions = await xenon.findVersions({ collection: "posts", id: "1" });
  const first = versions.docs[0]!;
  type _title = Expect<Equal<typeof first.doc.title, string>>;
  type _kind = Expect<Equal<typeof first.kind, "publish" | "draft" | "restore">>;
  const one = await xenon.findVersionById({ collection: "posts", id: "v" });
  type _one = Expect<Equal<typeof one, DocumentVersion<typeof first.doc> | null>>;
  const restored = await xenon.restoreVersion({ collection: "posts", id: "v", draft: false });
  type _restored = Expect<Equal<typeof restored.title, string>>;

  const schedule = await xenon.schedule({ collection: "posts", id: "1", publishAt: new Date(), unpublishAt: null });
  type _schedule = Expect<Equal<typeof schedule, DocumentSchedule>>;
  // @ts-expect-error - schedule instants are dates or ISO strings
  await xenon.schedule({ collection: "posts", id: "1", publishAt: 123 });
  const run = await xenon.runScheduled({ now: new Date() });
  type _run = Expect<Equal<typeof run, ScheduledRunResult>>;
  await xenon.update({ collection: "posts", id: "1", data: { title: "x" }, draft: true, autosave: true });
}
