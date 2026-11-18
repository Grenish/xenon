import { describe, expect, test } from "bun:test";
import { boolean, defineCollection, number, select, text } from "../../src/index";
import { XenonError } from "../../src/core/errors";
import { parseDraft, parseQuery, parseWhere } from "../../src/next/query";

const posts = defineCollection({ slug: "posts", fields: {
  title: text(), count: number(), featured: boolean(),
  category: select({ options: ["news", "guide"] }), tags: select({ options: ["one", "two"], hasMany: true }),
} });
const query = (value: string) => parseQuery(new URLSearchParams(value), posts);

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
});
