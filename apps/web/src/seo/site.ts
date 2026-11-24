import type { Metadata } from "next";

export const origin = "https://xenon.grenishrai.pro";
export const repository = "https://github.com/Grenish/xenon";
export const homeTitle = "Xenon — Open-source headless CMS for Next.js";
export const summary = "Xenon is a code-first headless CMS for Next.js. Define collections in TypeScript, edit content in a built-in admin, and keep your data in PostgreSQL or PGlite.";

export function absolute(path: string) {
  return new URL(path, origin).href;
}

export function docCardId(path: string) {
  return `${path.slice(1).replaceAll("/", "--")}.png`;
}

export function cardPath(path: string) {
  return path === "/" ? "/opengraph-image" : `/twitter-image/${docCardId(path)}`;
}

export function pageMetadata(path: string, title: string, description: string): Metadata {
  const url = absolute(path);
  const image = {
    url: absolute(cardPath(path)), width: 1200, height: 630,
    type: "image/png", alt: title,
  };

  return {
    title, description,
    alternates: { canonical: url },
    openGraph: {
      type: path === "/" ? "website" : "article",
      siteName: "Xenon", locale: "en_US", title, description, url, images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
