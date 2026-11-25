import { describe, expect, test } from "bun:test";
import { array, blocks, boolean, datetime, defineBlock, defineCollection, email, group, richText, text, url, validateCollectionData } from "../../src/index";
import { toClientCollection } from "../../src/ui/shared/client-config";
import { initialData, newBlock, normalizeFormData, validateFields } from "../../src/ui/form/model";
import { moveRow } from "../../src/ui/form/container-fields";
import { fromLocalDateTime, toLocalDateTime } from "../../src/ui/form/scalar-fields";
import type { AdminDoc } from "../../src/ui/shared/services";

const hero = defineBlock({ slug: "hero", labels: { singular: "Hero" }, fields: { heading: text({ required: true }), body: richText() } });
const cta = defineBlock({ slug: "cta", fields: { href: url({ required: true }), primary: boolean({ defaultValue: true }) } });

const pages = defineCollection({
  slug: "pages",
  fields: {
    title: text({ required: true }),
    seo: group({ fields: { title: text(), noIndex: boolean({ defaultValue: false }) } }),
    contacts: array({ fields: { address: email({ required: true }) }, maxRows: 2 }),
    layout: blocks({ blocks: [hero, cta], required: true }),
    publishAt: datetime(),
  },
});
const client = toClientCollection(pages);
const field = (name: string) => client.fields.find((f) => f.name === name)!;

describe("composite fields in the editor", () => {
  test("new documents get container defaults, recursively", () => {
    expect(initialData(client, null)).toEqual({ seo: { noIndex: false }, contacts: [], layout: [] });
  });

  test("stored rows keep their ids; unknown block types are dropped", () => {
    const doc = {
      id: "d1",
      data: {
        title: "Home",
        layout: [
          { id: "b1", blockType: "hero", heading: "Hi", body: { type: "doc", content: [{ type: "paragraph" }] } },
          { id: "b2", blockType: "removed", x: 1 },
        ],
      },
    } as unknown as AdminDoc;
    const data = initialData(client, doc);
    expect((data.layout as { id: string }[]).map((b) => b.id)).toEqual(["b1"]);
    expect(data.seo).toEqual({ noIndex: false });
  });

  test("new blocks start from their fields' defaults", () => {
    const block = newBlock(field("layout").blocks!.find((b) => b.slug === "cta")!);
    expect(block).toMatchObject({ blockType: "cta", primary: true });
    expect(block.id).toMatch(/^[0-9a-f]{16}$/);
  });

  test("client validation reports nested errors by dotted path", () => {
    const data = {
      title: "x",
      seo: { noIndex: false },
      contacts: [{ id: "c1", address: "nope" }, { id: "c2", address: "" }, { id: "c3", address: "a@b.co" }],
      layout: [{ id: "b1", blockType: "cta", href: "javascript:alert(1)", primary: true }],
    };
    expect(validateFields(client.fields, data, false)).toEqual({
      contacts: "Use 2 items or fewer.",
      "contacts.0.address": "Enter a valid email address.",
      "contacts.1.address": "Address is required.",
      "layout.0.href": "Use a link starting with http: or https:",
    });
    expect(validateFields(client.fields, { ...data, layout: [] }, false).layout).toBe("Layout is required.");
    // Drafts skip required and minimums, but formats still apply.
    expect(validateFields(client.fields, { contacts: [{ id: "c1", address: "" }], layout: [] }, true)).toEqual({});
  });

  test("normalized form data passes server validation", () => {
    const data = {
      title: "Home",
      seo: { title: "", noIndex: true },
      contacts: [{ id: "c1", address: "a@b.co" }],
      layout: [{ id: "b1", blockType: "hero", heading: "Hi" }],
      publishAt: "",
    };
    const payload = normalizeFormData(client.fields, data);
    expect(payload.seo).toEqual({ title: null, noIndex: true });
    expect(payload.publishAt).toBeNull();
    const result = validateCollectionData(pages, payload, { mode: "create" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.layout[0]!.id).toBe("b1");
  });
});

describe("row helpers", () => {
  test("moveRow", () => {
    expect(moveRow(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveRow(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveRow(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveRow(["a", "b"], 1, 9)).toEqual(["a", "b"]);
  });

  test("datetime-local round trip", () => {
    const iso = "2026-11-25T05:00:00.000Z";
    expect(fromLocalDateTime(toLocalDateTime(iso))).toBe(iso);
    expect(toLocalDateTime("garbage")).toBe("");
    expect(fromLocalDateTime("")).toBeNull();
  });
});
