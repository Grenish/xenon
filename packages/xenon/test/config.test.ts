import { describe, expect, test } from "bun:test";
import {
  XenonConfigError,
  defineCollection,
  defineConfig,
  media,
  number,
  relation,
  select,
  text,
  textarea,
} from "../src/index";

// Deliberately untyped definitions exercise runtime validation for JS consumers.
function expectConfigError(collections: unknown[], fragments: string[]) {
  let thrown: unknown;
  try {
    defineConfig({ collections: collections as never });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(XenonConfigError);
  if (!(thrown instanceof Error)) throw new Error("Expected a configuration error");
  for (const fragment of fragments) expect(thrown.message).toContain(fragment);
}

describe("defineConfig definition-time errors", () => {
  test("rejects duplicate collection slugs", () => {
    expectConfigError([
      { slug: "posts", fields: { title: text() } },
      { slug: "posts", fields: { heading: text() } },
    ], ["posts", "slug"]);
  });

  test.each(["", "Posts", "1posts", "my_posts", "my posts", "posts/child", "-posts"])(
    "rejects invalid slug %j", (slug) => {
      expectConfigError([{ slug, fields: { title: text() } }], [slug, "slug"]);
    },
  );

  test.each(["posts", "blog-posts", "posts123", "a"])("accepts valid slug %s", (slug) => {
    expect(() => defineConfig({ collections: [{ slug, fields: { title: text() } }] })).not.toThrow();
  });

  test.each(["id", "slug", "status", "createdAt", "updatedAt", "_private", "_"])(
    "rejects reserved field %s", (key) => {
      expectConfigError([{ slug: "posts", fields: { [key]: text() } }], ["posts", key]);
    },
  );

  test.each(["relation", "media"] as const)("rejects unknown %s targets", (kind) => {
    const field = kind === "relation" ? relation({ relationTo: "missing" }) : media({ relationTo: "missing" });
    expectConfigError([{ slug: "posts", fields: { cover: field } }], ["posts", "cover", "missing"]);
  });

  test("media targets must be upload collections", () => {
    expectConfigError([
      { slug: "posts", fields: { cover: media({ relationTo: "assets" }) } },
      { slug: "assets", fields: {} },
    ], ["posts", "cover", "assets"]);
  });

  test.each([true, { mimeTypes: ["image/*"], maxFileSize: 1024 }])(
    "accepts media targets with upload setting %j", (upload) => {
      expect(() => defineConfig({ collections: [
        defineCollection({ slug: "posts", fields: {
          cover: media({ relationTo: "assets" }),
          related: relation({ relationTo: "posts", hasMany: true }),
        } }),
        defineCollection({ slug: "assets", upload, fields: { alt: text() } }),
      ] })).not.toThrow();
    },
  );

  test("relations may target non-upload collections", () => {
    expect(() => defineConfig({ collections: [
      { slug: "posts", fields: { author: relation({ relationTo: "authors" }) } },
      { slug: "authors", fields: {} },
    ] })).not.toThrow();
  });

  test.each(["missing", "body", "count"])("rejects slugFrom %s when not a text field", (slugFrom) => {
    expectConfigError([{
      slug: "posts", slugFrom, fields: { title: text(), body: textarea(), count: number() },
    }], ["posts", "slugFrom"]);
  });

  test("rejects unknown useAsTitle keys", () => {
    expectConfigError([{
      slug: "posts", fields: { title: text() }, admin: { useAsTitle: "missing" },
    }], ["posts", "useAsTitle", "missing"]);
  });

  test("useAsTitle cannot refer to a system field", () => {
    expectConfigError([{
      slug: "posts", fields: { title: text() }, admin: { useAsTitle: "status" },
    }], ["posts", "useAsTitle", "status"]);
  });

  test("rejects unknown defaultColumns keys", () => {
    expectConfigError([{
      slug: "posts", fields: { title: text() }, admin: { defaultColumns: ["title", "missing"] },
    }], ["posts", "defaultColumns", "missing"]);
  });

  test("defaultColumns permits all system keys", () => {
    expect(() => defineConfig({ collections: [defineCollection({
      slug: "posts", slugFrom: "title", fields: { title: text() },
      admin: { useAsTitle: "title", defaultColumns: ["title", "id", "slug", "status", "createdAt", "updatedAt"] },
    })] })).not.toThrow();
  });

  test("rejects select fields without options", () => {
    expectConfigError([{ slug: "posts", fields: { category: select({ options: [] }) } }], ["posts", "category"]);
  });

  test("rejects invalid default values at definition time", () => {
    expectConfigError([{
      slug: "posts", fields: { count: number({ integer: true, defaultValue: 1.5 }) },
    }], ["posts", "count"]);
    expectConfigError([{
      slug: "posts", fields: { category: select({ options: ["news", "guide"], defaultValue: "other" }) },
    }], ["posts", "category"]);
  });

  test.each([
    { options: ["news", "news"] },
    { options: [{ label: "News", value: "news" }, { label: "Latest", value: "news" }] },
    { options: ["news", { label: "News", value: "news" }] },
  ])("rejects duplicate select values %j", ({ options }) => {
    expectConfigError([{
      slug: "posts", fields: { category: select({ options }) },
    }], ["posts", "category"]);
  });

  test.each(["filename", "mimeType", "filesize", "url", "width", "height"])(
    "rejects upload metadata field collision %s", (key) => {
      expectConfigError([{ slug: "assets", upload: true, fields: { [key]: text() } }], ["assets", key]);
    },
  );

  test("upload metadata names are available on ordinary collections", () => {
    expect(() => defineConfig({ collections: [{
      slug: "posts", upload: false, fields: { filename: text(), url: text() },
    }] })).not.toThrow();
  });
});
