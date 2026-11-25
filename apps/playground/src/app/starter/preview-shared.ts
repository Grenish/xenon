/** Preview-only constants shared by the server reader and the client switcher. */
export const VARIANTS = [
  { id: "sheet", label: "Sheet" },
  { id: "glow", label: "Glow" },
  { id: "tiles", label: "Tiles" },
] as const;
export type Variant = (typeof VARIANTS)[number]["id"];

export const STATES = [
  { id: "live", label: "Live", hint: "Real data from this playground" },
  { id: "fresh", label: "Fresh", hint: "Simulate a fresh install: no admin, no posts" },
  { id: "account", label: "Account", hint: "Simulate: admin created, no posts yet" },
] as const;
export type PreviewState = (typeof STATES)[number]["id"];

export const VARIANT_COOKIE = "starter_variant";
export const STATE_COOKIE = "starter_state";
