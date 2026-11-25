/**
 * Data for the starter preview. Mirrors what the create-xenon-app starter does: plain Local API calls
 * from server components (the starter has no `use cache`), plus the setup state for onboarding.
 */
import { getXenon } from "xenon-cms/next";
import { countUsers } from "xenon-cms/http";
import config, { type Post } from "@/xenon.config";

export type { Post };

export interface Cover {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface PostCard {
  post: Post;
  cover: Cover | null;
}

export interface Setup {
  hasAdmin: boolean;
  hasPosts: boolean;
}

const xenon = () => getXenon(config);

async function coverOf(id: string | null | undefined): Promise<Cover | null> {
  if (!id) return null;
  const media = await xenon().findById({ collection: "media", id });
  return media ? { url: media.url, alt: media.alt, width: media.width ?? null, height: media.height ?? null } : null;
}

export async function getPosts(): Promise<PostCard[]> {
  const { docs } = await xenon().find({ collection: "posts", sort: "-createdAt", limit: 20 });
  return Promise.all((docs as Post[]).map(async (post) => ({ post, cover: await coverOf(post.cover) })));
}

export async function getPost(slug: string): Promise<PostCard | null> {
  const post = (await xenon().findBySlug({ collection: "posts", slug })) as Post | null;
  return post ? { post, cover: await coverOf(post.cover) } : null;
}

export async function getSetup(postCount: number): Promise<Setup> {
  return { hasAdmin: (await countUsers(xenon())) > 0, hasPosts: postCount > 0 };
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

export function readingMinutes(post: Post): number {
  const text = JSON.stringify(post.body ?? "");
  return Math.max(1, Math.round(text.split(/\s+/).length / 230));
}

/** The onboarding checklist. Order matters: each step needs the previous one. */
export function setupSteps(setup: Setup) {
  return [
    {
      title: "Create your admin account",
      detail: "The first account you create in the admin becomes the administrator.",
      href: "/admin",
      action: "Open the admin",
      done: setup.hasAdmin,
    },
    {
      title: "Publish your first post",
      detail: "Give it a cover image and an excerpt and it shows up on this page.",
      href: "/admin/collections/posts/new",
      action: "Write a post",
      done: setup.hasPosts,
    },
    {
      title: "Make this page yours",
      detail: "It's a normal Next.js page in src/app/page.tsx. Change anything.",
      href: null,
      action: null,
      done: false,
    },
  ] as const;
}

/** The query this page runs, shown in the onboarding so it's easy to copy. */
export const QUERY_SNIPPET = `const { docs } = await getXenon(config).find({
  collection: "posts",
  sort: "-createdAt",
});`;

export const SITE_NAME = "My Site";

/** Route prefix of the preview (the starter itself lives at "/"). */
export const BASE = "/starter";
export const homeHref = BASE || "/";
export const postHref = (post: Post) => `${BASE}/posts/${encodeURIComponent(post.slug ?? post.id)}`;
export const editHref = (post: Post) => `/admin/collections/posts/${post.id}`;
export const NEW_POST_HREF = "/admin/collections/posts/new";

export const CATEGORY_LABEL: Record<string, string> = { news: "News", guide: "Guide", release: "Release" };
