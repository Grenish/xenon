import {
  array,
  blocks,
  boolean,
  defineBlock,
  defineCollection,
  defineConfig,
  defineGlobal,
  getGlobal,
  group,
  media,
  relation,
  text,
  textarea,
} from "../src/index";
import type {
  GlobalBySlug,
  GlobalSlug,
  InferCollectionType,
  InferConfigGlobals,
  InferGlobalCreateInput,
  InferGlobalData,
  InferGlobalDraftInput,
  InferGlobalType,
  InferGlobalUpdateInput,
  XenonConfig,
} from "../src/index";
import { createXenon, type XenonInstance } from "../src/server";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
    : false;
type Expect<T extends true> = T;

const mediaColl = defineCollection({
  slug: "media",
  upload: true,
  fields: {
    alt: text({ required: true }),
  },
});

const pages = defineCollection({
  slug: "pages",
  slugFrom: "title",
  fields: {
    title: text({ required: true }),
    heroImage: media({ relationTo: "media" }),
  },
});

const ctaBlock = defineBlock({
  slug: "cta",
  fields: {
    heading: text({ required: true }),
    target: relation({ relationTo: "pages" }),
  },
});

const noteBlock = defineBlock({
  slug: "note",
  fields: {
    body: textarea({ required: true }),
  },
});

const siteSettings = defineGlobal({
  slug: "site-settings",
  label: "Site Settings",
  fields: {
    siteName: text({ required: true }),
    tagline: text({ defaultValue: "Built with Xenon" }),
    maintenanceMode: boolean({ defaultValue: false }),
    logo: media({ relationTo: "media" }),
    homePage: relation({ relationTo: "pages" }),
    featuredPages: relation({ relationTo: "pages", hasMany: true }),
    seo: group({
      fields: {
        titleSuffix: text(),
        ogImage: media({ relationTo: "media" }),
      },
    }),
    nav: array({
      fields: {
        label: text({ required: true }),
        page: relation({ relationTo: "pages" }),
      },
    }),
    banners: blocks({ blocks: [ctaBlock, noteBlock] }),
  },
});

const footer = defineGlobal({
  slug: "footer",
  label: "Footer",
  drafts: false,
  fields: {
    copyright: text({ required: true }),
  },
});

const config = defineConfig({
  collections: [mediaColl, pages],
  globals: [siteSettings, footer],
});
const configWithoutGlobals = defineConfig({
  collections: [mediaColl, pages],
});

const xenon = createXenon(config);
const xenonNoGlobals = createXenon(configWithoutGlobals);

type MediaDoc = InferCollectionType<typeof mediaColl>;
type PageDoc = InferCollectionType<typeof pages>;
type SiteSettingsDoc = InferGlobalType<typeof siteSettings>;
type FooterDoc = InferGlobalType<typeof footer>;

// 1. Config-level slug & map inference.
type TSlugs = Expect<Equal<GlobalSlug<typeof config>, "site-settings" | "footer">>;
type TNoSlugs = Expect<Equal<GlobalSlug<typeof configWithoutGlobals>, never>>;
type TBySlug = Expect<Equal<GlobalBySlug<typeof config, "footer">, typeof footer>>;
type TConfigGlobals = Expect<Equal<InferConfigGlobals<typeof config>, { "site-settings": SiteSettingsDoc; footer: FooterDoc }>>;
type TData = Expect<Equal<InferGlobalData<typeof footer>, { copyright: string }>>;
type TCreate = Expect<Equal<InferGlobalCreateInput<typeof footer>, { copyright: string }>>;
type TUpdate = Expect<Equal<InferGlobalUpdateInput<typeof footer>, { copyright?: string }>>;
type TDraft = Expect<Equal<InferGlobalDraftInput<typeof footer>, { copyright?: string | null }>>;

// 2. Plain getGlobal / updateGlobal / unpublishGlobal return types.
async function plainGlobals() {
  const settings = await xenon.getGlobal({ slug: "site-settings" });
  const updated = await xenon.updateGlobal({ slug: "site-settings", data: { siteName: "Acme" } });
  const unpub = await xenon.unpublishGlobal({ slug: "site-settings" });
  const found = getGlobal(config, "footer");
  type TGet = Expect<Equal<typeof settings, SiteSettingsDoc | null>>;
  type TUpd = Expect<Equal<typeof updated, SiteSettingsDoc>>;
  type TUnpub = Expect<Equal<typeof unpub, SiteSettingsDoc>>;
  type TFound = Expect<Equal<typeof found, typeof siteSettings | typeof footer | undefined>>;
  return [settings, updated, unpub, found] as unknown as [TGet, TUpd, TUnpub, TFound, TSlugs, TNoSlugs, TBySlug, TConfigGlobals, TData, TCreate, TUpdate, TDraft];
}

// 3. Select projection on getGlobal (root fields, system keys, nested group; `id` always kept).
async function selectGlobal() {
  const res = await xenon.getGlobal({
    slug: "site-settings",
    select: { siteName: true, slug: true, seo: { titleSuffix: true } },
  });
  type TSelect = Expect<Equal<typeof res, {
    id: string;
    slug: "site-settings";
    siteName: string;
    seo: { titleSuffix?: string | null };
  } | null>>;
  return res as unknown as TSelect;
}

// 4. Populate on getGlobal (single, hasMany, nested populate + select, group, array, blocks).
async function populateGlobal() {
  const res = await xenon.getGlobal({
    slug: "site-settings",
    populate: {
      logo: true,
      homePage: { select: { title: true }, populate: { heroImage: { select: { url: true } } } },
      featuredPages: { select: { title: true } },
      seo: { ogImage: { select: { url: true } } },
      nav: { page: { select: { title: true } } },
      banners: { cta: { target: { select: { title: true } } } },
    },
  });
  type Doc = NonNullable<typeof res>;
  type TLogo = Expect<Equal<Doc["logo"], MediaDoc | null | undefined>>;
  type THome = Expect<Equal<Doc["homePage"], {
    id: string;
    title: string;
    heroImage?: { id: string; url: string } | null;
  } | null | undefined>>;
  type TFeatured = Expect<Equal<Doc["featuredPages"], { id: string; title: string }[] | null | undefined>>;
  type TSeo = Expect<Equal<Doc["seo"], { titleSuffix?: string | null; ogImage?: { id: string; url: string } | null }>>;
  type TNav = Expect<Equal<Doc["nav"], { id: string; label: string; page?: { id: string; title: string } | null }[]>>;
  type TBanners = Expect<Equal<
    Doc["banners"],
    (
      | { blockType: "cta"; id: string; heading: string; target?: { id: string; title: string } | null }
      | { blockType: "note"; id: string; body: string }
    )[]
  >>;
  return res as unknown as [TLogo, THome, TFeatured, TSeo, TNav, TBanners, PageDoc];
}

// 5. Combined select + populate preserves populated keys even when omitted from select.
async function selectAndPopulateGlobal() {
  const res = await xenon.getGlobal({
    slug: "site-settings",
    select: { siteName: true },
    populate: { logo: true },
  });
  type TCombined = Expect<Equal<typeof res, {
    id: string;
    siteName: string;
    logo?: MediaDoc | null;
  } | null>>;
  return res as unknown as TCombined;
}

// 6. Erased XenonInstance<XenonConfig> still allows literal global slugs (e.g. from hooks or helpers).
async function erasedInstance(erased: XenonInstance<XenonConfig>) {
  const doc = await erased.getGlobal({ slug: "site-settings", select: { siteName: true }, populate: { logo: true } });
  const updated = await erased.updateGlobal({ slug: "site-settings", data: { siteName: "Hi" } });
  const unpub = await erased.unpublishGlobal({ slug: "site-settings" });
  return [doc, updated, unpub];
}

// 7. Compile-time negative checks (@ts-expect-error).
async function invalidGlobalUsages() {
  // @ts-expect-error — unknown global slug
  await xenon.getGlobal({ slug: "missing" });
  // @ts-expect-error — no globals registered in configWithoutGlobals
  await xenonNoGlobals.getGlobal({ slug: "site-settings" });
  // @ts-expect-error — unknown field in select
  await xenon.getGlobal({ slug: "site-settings", select: { nope: true } });
  // @ts-expect-error — exclusion mode (false) not allowed in select
  await xenon.getGlobal({ slug: "site-settings", select: { siteName: false } });
  // @ts-expect-error — cannot populate a plain text field
  await xenon.getGlobal({ slug: "site-settings", populate: { siteName: true } });
  // @ts-expect-error — note block has no relation/media fields
  await xenon.getGlobal({ slug: "site-settings", populate: { banners: { note: { body: true } } } });
  // @ts-expect-error — unknown field in nested target select
  await xenon.getGlobal({ slug: "site-settings", populate: { homePage: { select: { unknown: true } } } });
  // @ts-expect-error — unknown field in updateGlobal data
  await xenon.updateGlobal({ slug: "footer", data: { nope: "x" } });
}

export { plainGlobals, selectGlobal, populateGlobal, selectAndPopulateGlobal, erasedInstance, invalidGlobalUsages };
