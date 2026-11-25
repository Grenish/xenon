import { z } from "zod";
import {
  array,
  blocks,
  boolean,
  date,
  datetime,
  defineBlock,
  defineCollection,
  email,
  group,
  json,
  number,
  select,
  text,
  url,
} from "../src/index";
import type {
  InferBlockType,
  InferCollectionData,
  InferCreateInput,
  InferDraftInput,
  JsonValue,
} from "../src/index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
    : false;
type Expect<T extends true> = T;

const scalars = defineCollection({
  slug: "scalars",
  fields: {
    day: date({ required: true }),
    at: datetime(),
    contact: email({ required: true }),
    site: url(),
    raw: json(),
    typed: json({ schema: z.object({ n: z.number(), tags: z.array(z.string()) }) }),
  },
});

type ScalarsRead = Expect<Equal<InferCollectionData<typeof scalars>, {
  day: string;
  contact: string;
  at?: string | null;
  site?: string | null;
  raw?: JsonValue | null;
  typed?: { n: number; tags: string[] } | null;
}>>;

const hero = defineBlock({ slug: "hero", fields: { heading: text({ required: true }), dark: boolean({ defaultValue: false }) } });
const quote = defineBlock({ slug: "quote", fields: { body: text({ required: true }), author: text() } });

const pages = defineCollection({
  slug: "pages",
  fields: {
    seo: group({ fields: { title: text(), noIndex: boolean({ defaultValue: false }) } }),
    address: group({ fields: { city: text({ required: true }), zip: text() } }),
    links: array({ fields: { label: text({ required: true }), kind: select({ options: ["internal", "external"] }) } }),
    tags: array({ fields: { name: text() }, required: true }),
    layout: blocks({ blocks: [hero, quote] }),
    count: number(),
  },
});

type Pages = InferCollectionData<typeof pages>;

type SeoRead = Expect<Equal<Pages["seo"], { noIndex: boolean; title?: string | null }>>;
type LinksRead = Expect<Equal<Pages["links"], { id: string; label: string; kind?: "internal" | "external" | null }[]>>;
type LayoutRead = Expect<Equal<
  Pages["layout"],
  ({ blockType: "hero"; id: string; heading: string; dark: boolean } | { blockType: "quote"; id: string; body: string; author?: string | null })[]
>>;
// Containers always read as a value.
type ContainersPresent = Expect<Equal<
  { [K in keyof Pages as undefined extends Pages[K] ? K : never]: true },
  { count?: true }
>>;
type BlockType = Expect<Equal<InferBlockType<typeof quote>, { blockType: "quote"; id: string; body: string; author?: string | null }>>;

type PagesCreate = InferCreateInput<typeof pages>;
// `address` has a required field, so it must be supplied; `tags` is required; the rest are optional.
type CreateRequired = Expect<Equal<
  { [K in keyof PagesCreate as undefined extends PagesCreate[K] ? never : K]: true },
  { address: true; tags: true }
>>;
type CreateLinks = Expect<Equal<
  PagesCreate["links"],
  { id?: string; label: string; kind?: "internal" | "external" | null }[] | undefined
>>;
type CreateLayout = Expect<Equal<
  PagesCreate["layout"],
  ({ blockType: "hero"; id?: string; heading: string; dark?: boolean | null } | { blockType: "quote"; id?: string; body: string; author?: string | null })[] | undefined
>>;

type PagesDraft = InferDraftInput<typeof pages>;
type DraftAddress = Expect<Equal<PagesDraft["address"], { city?: string | null; zip?: string | null } | null | undefined>>;

// Groups cannot be required or defaulted themselves.
// @ts-expect-error
group({ fields: { a: text() }, required: true });
// @ts-expect-error
group({ fields: { a: text() }, defaultValue: {} });
// Boolean display is typed.
// @ts-expect-error
boolean({ admin: { display: "toggle" } });

const createOk: PagesCreate = { address: { city: "Pokhara" }, tags: [], layout: [{ blockType: "hero", heading: "Hi" }] };
// @ts-expect-error — hero needs a heading
const createBad: PagesCreate = { address: { city: "Pokhara" }, tags: [], layout: [{ blockType: "hero" }] };

export type {
  ScalarsRead, SeoRead, LinksRead, LayoutRead, ContainersPresent, BlockType, CreateRequired, CreateLinks, CreateLayout, DraftAddress,
};
export { createOk, createBad };
