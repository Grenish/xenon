import { cacheLife, cacheTag } from "next/cache";
import { getXenon, xenonTags } from "xenon-cms/next";
import config, { type Post } from "@/xenon.config";

/** Published posts via the Local API — cached, and invalidated automatically when editors publish. */
export async function getPublishedPosts() {
  "use cache";
  cacheTag(xenonTags.collection("posts"));
  cacheLife("max");
  const { docs } = await getXenon(config).find({ collection: "posts", sort: "-createdAt", limit: 20 });
  return docs as Post[];
}

export async function getPost(slug: string) {
  "use cache";
  cacheTag(xenonTags.collection("posts"));
  cacheLife("max");
  return (await getXenon(config).findBySlug({ collection: "posts", slug })) as Post | null;
}

export async function getMediaUrl(id: string | null | undefined) {
  "use cache";
  cacheTag(xenonTags.collection("media"));
  cacheLife("max");
  if (!id) return null;
  const media = await getXenon(config).findById({ collection: "media", id });
  return media ? { url: media.url, alt: media.alt, width: media.width, height: media.height } : null;
}
