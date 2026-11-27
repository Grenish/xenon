import { array, defineCollection, defineConfig, group, number, relation, select, text } from "../src/index";
import type { CollectionHooks, HookContext, XenonUser } from "../src/index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
    : false;
type Expect<T extends true> = T;

// Collection hooks are typed from `fields`.
export const posts = defineCollection({
  slug: "posts",
  fields: {
    title: text({ required: true }),
    words: number(),
    kind: select({ options: ["news", "blog"] }),
    seo: group({ fields: { noIndex: text() } }),
    links: array({ fields: { url: text({ required: true }) } }),
    author: relation({ relationTo: "authors" }),
  },
  hooks: {
    beforeValidate: ({ data, operation, originalDoc, draft, user, context }) => {
      type _data = Expect<Equal<typeof data.title, string | undefined>>;
      type _kind = Expect<Equal<typeof data.kind, "news" | "blog" | null | undefined>>;
      type _op = Expect<Equal<typeof operation, "create" | "update">>;
      type _orig = Expect<Equal<typeof originalDoc extends null ? true : false, false>>;
      const id: string | undefined = originalDoc?.id;
      const t: string | undefined = originalDoc?.title;
      type _draft = Expect<Equal<typeof draft, boolean>>;
      type _user = Expect<Equal<typeof user, XenonUser | null>>;
      type _ctx = Expect<Equal<typeof context, HookContext>>;
      void id;
      void t;
      return { ...data, words: 1 };
    },
    beforeChange: [
      ({ data }) => ({ ...data, words: 2 }),
      () => {},
    ],
    afterChange: ({ doc, previousDoc, operation }) => {
      type _doc = Expect<Equal<typeof doc.title, string>>;
      type _status = Expect<Equal<typeof doc.status, "draft" | "published">>;
      type _prev = Expect<Equal<typeof previousDoc extends null ? true : false, false>>;
      type _op = Expect<Equal<typeof operation, "create" | "update" | "unpublish" | "restore">>;
      const url: string | undefined = doc.links[0]?.url;
      void url;
    },
    afterRead: ({ doc }) => ({ ...doc, title: doc.title.toUpperCase() }),
    beforeDelete: ({ id, doc }) => {
      type _id = Expect<Equal<typeof id, string>>;
      void doc.title;
    },
    afterDelete: async () => {},
  },
});

defineCollection({
  slug: "z",
  fields: { words: number() },
  hooks: {
    // @ts-expect-error - words is a number
    beforeChange: () => ({ words: "many" }),
  },
});

// @ts-expect-error - unknown field in returned data is a type error
defineCollection({ slug: "x", fields: { a: text() }, hooks: { afterRead: ({ doc }) => ({ ...doc, a: 1 }) } });

// @ts-expect-error - unknown hook name
defineCollection({ slug: "y", fields: { a: text() }, hooks: { beforeSave: () => {} } });

// Field hooks are typed by the field's value.
export const authors = defineCollection({
  slug: "authors",
  fields: {
    name: text({
      hooks: {
        beforeValidate: ({ value, siblingData, path, operation }) => {
          type _v = Expect<Equal<typeof value, string | null | undefined>>;
          type _s = Expect<Equal<typeof siblingData, Record<string, unknown>>>;
          type _p = Expect<Equal<typeof path, readonly (string | number)[]>>;
          type _o = Expect<Equal<typeof operation, "create" | "update">>;
          return value?.trim();
        },
        afterChange: ({ operation }) => {
          type _o = Expect<Equal<typeof operation, "create" | "update" | "unpublish" | "restore">>;
        },
        // @ts-expect-error - a text field hook cannot return a number
        afterRead: () => 42,
      },
    }),
    age: number({ hooks: { beforeChange: ({ value }) => (value ?? 0) + 1 } }),
  },
});

export const config = defineConfig({ collections: [posts, authors] });

// Hook types are exported for plugin authors.
export const shared: CollectionHooks = { afterRead: ({ doc }) => doc };
