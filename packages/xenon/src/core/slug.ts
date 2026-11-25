/** Slug helpers. Isomorphic and dependency-free (the admin uses `slugify` for live previews). */

/**
 * URL-safe slug. Latin diacritics are folded to ASCII (`Café` → `cafe`); letters and digits of other
 * scripts are kept (`日本語のタイトル` → `日本語のタイトル`) rather than dropped, so non-Latin titles
 * still get a slug. Capped at 96 code points.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // Recompose what the strip left decomposed (e.g. Japanese voiced kana) before matching.
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return Array.from(slug).slice(0, 96).join("").replace(/-+$/g, "");
}
