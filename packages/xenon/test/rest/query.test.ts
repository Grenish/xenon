import { describe, expect, test } from "bun:test";
import type { Where } from "../../src/adapters/types";
import {
  array,
  blocks,
  boolean,
  defineBlock,
  defineCollection,
  group,
  json,
  media,
  number,
  relation,
  select,
  text,
} from "../../src/index";
import { XenonError } from "../../src/core/errors";
import { parseDraft, parsePopulate, parseQuery, parseReadQuery, parseSelect, parseWhere } from "../../src/next/query";

const hero = defineBlock({
  slug: "hero",
  fields: { heading: text({ required: true }), image: media({ relationTo: "media" }) },
});
const mediaColl = defineCollection({ slug: "media", upload: true, fields: { alt: text() } });
const authors = defineCollection({ slug: "authors", fields: { name: text(), avatar: media({ relationTo: "media" }) } });
const posts = defineCollection({ slug: "posts", fields: {
  title: text(), count: number(), featured: boolean(),
  category: select({ options: ["news", "guide"] }), tags: select({ options: ["one", "two"], hasMany: true }),
  author: relation({ relationTo: "authors" }),
  cover: media({ relationTo: "media" }),
  seo: group({ fields: { title: text(), noIndex: boolean(), score: number(), ogImage: media({ relationTo: "media" }) } }),
  items: array({ fields: { label: text(), asset: media({ relationTo: "media" }) } }),
  layout: blocks({ blocks: [hero] }),
  meta: json(),
} });
const lookup = (slug: string) => [posts, authors, mediaColl].find((c) => c.slug === slug);
const query = (value: string) => parseQuery(new URLSearchParams(value), posts, lookup);

describe("REST query parser", () => {
  test("defaults, cap, no-limit cap, pagination, and draft parsing", () => {
    expect(query("")).toEqual({ limit: 10, page: 1, draft: false });
    expect(query("limit=1000&page=3&draft=true&sort=-count")).toEqual({ limit: 100, page: 3, draft: true, sort: "-count" });
    expect(query("limit=0&draft=false")).toEqual({ limit: 100, page: 1, draft: false });
    expect(query("limit=2&page=2").limit).toBe(2);
  });

  test("bracket operators coerce numbers/booleans and keep select/text strings", () => {
    expect(query("where[count][gte]=2&where[count][lt]=10&where[featured][equals]=false&where[title][contains]=NEWS&where[category][equals]=news").where).toEqual({
      count: { gte: 2, lt: 10 }, featured: { equals: false }, title: { contains: "NEWS" }, category: { equals: "news" },
    });
    expect(query("where[count][in]=1,2&where[count][in]=3&where[category][not_in]=news,guide").where).toEqual({
      count: { in: [1, 2, 3] }, category: { not_in: ["news", "guide"] },
    });
    expect(query("where[title][exists]=false").where).toEqual({ title: { exists: false } });
    expect(query("where[status][equals]=published&sort=updatedAt").where).toEqual({ status: { equals: "published" } });
  });

  test("JSON filters nest and/or, preserve null/deep arrays, and coerce typed values", () => {
    const input = { and: [{ count: { in: ["2", "3"] } }, { or: [{ featured: { equals: "true" } }, { title: { equals: null } }] }], tags: { equals: ["one", "two"] } };
    expect(parseQuery(new URLSearchParams({ where: JSON.stringify(input) }), posts).where).toEqual({
      and: [{ count: { in: [2, 3] } }, { or: [{ featured: { equals: true } }, { title: { equals: null } }] }], tags: { equals: ["one", "two"] },
    });
  });

  test("upload metadata is queryable only on upload collections", () => {
    const uploads = defineCollection({ slug: "media", upload: true, fields: {} });
    expect(parseQuery(new URLSearchParams("where[filesize][gt]=123&sort=-width"), uploads).where).toEqual({ filesize: { gt: 123 } });
    expect(() => query("where[filesize][gt]=123")).toThrow(XenonError);
  });

  test.each([
    "limit=-1", "limit=abc", "limit=1.5", "limit=Infinity", "page=0", "page=-2", "page=x", "page=2&page=3",
    "sort=missing", "sort=--title", "sort=", "draft=1", "draft=true&draft=false",
    "where=not-json", "where=null", "where=[]", "where={}&where[count][gt]=1", "where={}&where={}",
    "where[count][missing]=1", "where[unknown][equals]=x", "where[count][equals]=NaN", "where[count][equals]=Infinity",
    "where[count][equals]=", "where[featured][equals]=1", "where[featured][exists]=yes", "where[title]=x",
    "where[title][contains]=a&where[title][contains]=b", "where[constructor][equals]=x", "where[__proto__][equals]=x",
  ])("invalid query %s returns BAD_REQUEST", (value) => {
    let error: unknown;
    try { query(value); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(XenonError);
    expect((error as XenonError).status).toBe(400);
  });

  test.each([
    { count: { in: "1,2" } }, { and: {} }, { or: [null] }, { title: "hello" },
    { featured: { gt: true } }, { title: { unknown: "x" } },
  ])("invalid JSON where %j is rejected", (input) => {
    expect(() => parseWhere(posts, input)).toThrow(XenonError);
  });

  test("draft parser works independently for document writes", () => {
    expect(parseDraft(new URLSearchParams("draft=true"))).toBe(true);
    expect(parseDraft(new URLSearchParams())).toBe(false);
  });

  test("Low #24: empty bracket in/not_in parses as [] and parseWhere caps recursion depth", () => {
    expect(query("where[category][in]=").where).toEqual({ category: { in: [] } });
    expect(query("where[count][in]=").where).toEqual({ count: { in: [] } });
    expect(query("where[category][not_in]=").where).toEqual({ category: { not_in: [] } });
    expect(query("where[count][in]=&where[count][in]=2").where).toEqual({ count: { in: [2] } });

    // Within depth limit succeeds
    let validNested: Where = { title: { equals: "ok" } };
    for (let i = 0; i < 8; i++) validNested = { and: [validNested] };
    expect(parseWhere(posts, validNested)).toEqual(validNested);

    // Excessive and/or nesting rejects with BAD_REQUEST instead of RangeError
    let deepWhere: Record<string, unknown> = { title: { equals: "boom" } };
    for (let i = 0; i < 30; i++) deepWhere = { and: [deepWhere] };
    expect(() => parseWhere(posts, deepWhere)).toThrow(XenonError);

    // Excessive nested array depth inside operator values rejects with BAD_REQUEST
    let deepArray: unknown = "x";
    for (let i = 0; i < 30; i++) deepArray = [deepArray];
    expect(() => parseWhere(posts, { tags: { equals: deepArray } })).toThrow(XenonError);

    // Excessive nested object depth inside operator values also rejects with BAD_REQUEST
    let deepObject: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 30; i++) deepObject = { nested: deepObject };
    expect(() => parseWhere(posts, { title: { equals: deepObject } })).toThrow(XenonError);
  });

  test("fieldType maps json/group/array/blocks to json and traverses group and json dot-paths", () => {
    expect(parseWhere(posts, { meta: { equals: { env: "prod", count: 3 } } })).toEqual({ meta: { equals: { env: "prod", count: 3 } } });
    expect(parseWhere(posts, { meta: { equals: 42 } })).toEqual({ meta: { equals: 42 } });
    expect(parseWhere(posts, { seo: { equals: { title: "Hi", noIndex: false } } })).toEqual({ seo: { equals: { title: "Hi", noIndex: false } } });
    expect(parseWhere(posts, { items: { contains: { label: "a" } } })).toEqual({ items: { contains: { label: "a" } } });
    expect(parseWhere(posts, { layout: { exists: true } })).toEqual({ layout: { exists: true } });

    // Nested dot-paths inside group coerce using the leaf field type
    expect(query("where[seo.noIndex][equals]=true&where[seo.score][gte]=5&sort=-seo.score")).toMatchObject({
      where: { "seo.noIndex": { equals: true }, "seo.score": { gte: 5 } },
      sort: "-seo.score",
    });
    // Nested dot-paths inside free-form json accept arbitrary paths & JSON values
    expect(parseWhere(posts, { "meta.nested.count": { gt: 2 }, "meta.nested.enabled": { equals: true } })).toEqual({
      "meta.nested.count": { gt: 2 },
      "meta.nested.enabled": { equals: true },
    });
    expect(query("where[meta.env][equals]=prod&sort=meta.rank")).toMatchObject({
      where: { "meta.env": { equals: "prod" } },
      sort: "meta.rank",
    });

    // Invalid dot-paths reject with BAD_REQUEST
    for (const bad of [
      "where[seo.missing][equals]=x",
      "where[seo.noIndex][equals]=maybe",
      "where[seo.score][gte]=abc",
      "where[title.sub][equals]=x",
      "where[items.label][equals]=x",
      "where[seo..noIndex][equals]=true",
      "where[.seo][equals]=true",
      "where[seo.__proto__][equals]=x",
      "sort=seo.missing",
    ]) {
      expect(() => query(bad)).toThrow(XenonError);
    }
  });

  test("select parses comma shorthand, brackets, nested groups, and JSON while rejecting invalid specs", () => {
    expect(parseSelect(new URLSearchParams("select=title,slug,seo.noIndex"), posts)).toEqual({
      title: true,
      slug: true,
      seo: { noIndex: true },
    });
    expect(parseSelect(new URLSearchParams("select[title]=true&select[seo][title]=true"), posts)).toEqual({
      title: true,
      seo: { title: true },
    });
    expect(parseSelect(new URLSearchParams({ select: JSON.stringify({ title: true, seo: { noIndex: true } }) }), posts)).toEqual({
      title: true,
      seo: { noIndex: true },
    });
    expect(query("select=title,slug")).toEqual({ limit: 10, page: 1, draft: false, select: { title: true, slug: true } });

    for (const bad of [
      "select=",
      "select={}",
      "select=[]",
      "select=not-json-field",
      "select=title&select[slug]=true",
      "select[title]=false",
      "select[title][sub]=true",
      "select[seo]=true&select[seo][noIndex]=true",
      "select[__proto__]=true",
      `select=${encodeURIComponent(JSON.stringify({ title: false }))}`,
    ]) {
      expect(() => query(bad)).toThrow(XenonError);
    }
  });

  test("populate parses brackets, nested populate/select, comma shorthand, composite paths, and JSON", () => {
    expect(parsePopulate(new URLSearchParams("populate[author]=true&populate[cover]=true"), posts, lookup)).toEqual({
      author: true,
      cover: true,
    });
    expect(parsePopulate(new URLSearchParams("populate[author]=false"), posts, lookup)).toBeUndefined();
    expect(
      parsePopulate(
        new URLSearchParams("populate[author][populate][avatar][select][url]=true&populate[author][select][name]=true"),
        posts,
        lookup,
      ),
    ).toEqual({
      author: {
        select: { name: true },
        populate: { avatar: { select: { url: true } } },
      },
    });
    // Upgrade `populate[author]=true` when paired with nested option
    expect(
      parsePopulate(new URLSearchParams("populate[author]=true&populate[author][select][name]=true"), posts, lookup),
    ).toEqual({ author: { select: { name: true } } });
    expect(parsePopulate(new URLSearchParams("populate=author,cover,seo.ogImage,layout.hero.image"), posts, lookup)).toEqual({
      author: true,
      cover: true,
      seo: { ogImage: true },
      layout: { hero: { image: true } },
    });
    expect(
      parseReadQuery(
        new URLSearchParams("draft=true&select=title&populate[items][asset][select][alt]=true"),
        posts,
        lookup,
      ),
    ).toEqual({
      draft: true,
      select: { title: true },
      populate: { items: { asset: { select: { alt: true } } } },
    });

    for (const bad of [
      "populate=",
      "populate=[]",
      "populate=title",
      "populate=author&populate[cover]=true",
      "populate[title]=true",
      "populate[unknown]=false",
      "populate[author][select][missing]=true",
      "populate[author][select][name]=false",
      "populate[author][unknownOpt][name]=true",
      "populate[layout][missingBlock][image]=true",
      "populate[__proto__]=true",
    ]) {
      expect(() => query(bad)).toThrow(XenonError);
    }
  });
});
