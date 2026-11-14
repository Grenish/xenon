import { describe, expect, test } from "bun:test";
import {
  boolean,
  defineCollection,
  media,
  number,
  relation,
  richText,
  select,
  text,
  textarea,
} from "../src/index";

describe("public field helpers", () => {
  test("helpers retain their discriminant and the supplied options", () => {
    const validate = (value: string) => value.length > 0 || "Required";
    const pattern = /^[a-z]+$/;
    const options = {
      label: "Headline",
      required: true,
      defaultValue: "hello",
      minLength: 1,
      maxLength: 200,
      pattern,
      validate,
      admin: { description: "A title", hidden: false, readOnly: true, position: "main" },
    } as const;
    expect(text(options)).toEqual({ type: "text", ...options });
    expect(text(options).validate).toBe(validate);
    expect(text(options).pattern).toBe(pattern);
    expect(textarea({ rows: 4, minLength: 2, maxLength: 500 })).toEqual({
      type: "textarea", rows: 4, minLength: 2, maxLength: 500,
    });
    expect(number({ min: 0, max: 100, integer: true })).toEqual({
      type: "number", min: 0, max: 100, integer: true,
    });
    expect(boolean({ defaultValue: false })).toEqual({ type: "boolean", defaultValue: false });
    expect(select({ options: ["news", { label: "Guide", value: "guide" }], hasMany: true })).toEqual({
      type: "select", options: ["news", { label: "Guide", value: "guide" }], hasMany: true,
    });
    expect(richText()).toEqual({ type: "richText" });
    expect(media({ relationTo: "media", hasMany: true })).toEqual({
      type: "media", relationTo: "media", hasMany: true,
    });
    expect(relation({ relationTo: "posts" })).toEqual({ type: "relation", relationTo: "posts" });
  });

  test("helpers without required options accept no argument", () => {
    expect(text()).toEqual({ type: "text" });
    expect(textarea()).toEqual({ type: "textarea" });
    expect(number()).toEqual({ type: "number" });
    expect(boolean()).toEqual({ type: "boolean" });
  });

  test("defineCollection preserves the config object identity", () => {
    const collection = {
      slug: "posts",
      fields: { title: text({ required: true }) },
      slugFrom: "title",
      admin: { useAsTitle: "title", defaultColumns: ["title", "status"] },
    } as const;
    expect(defineCollection(collection)).toBe(collection);
  });
});
