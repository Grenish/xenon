import type { MetadataRoute } from "next";
import { href, nav } from "@/docs/nav";
import { absolute } from "@/seo/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", ...nav.flatMap(({ pages }) => pages.map(({ slug }) => href(slug)))];
  return paths.map((path) => ({ url: absolute(path) }));
}
