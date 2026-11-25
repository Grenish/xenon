---
"xenon-cms": minor
---

Editable slugs. `create` / `update` accept `slug` (a string sets it by hand; `null` switches back to automatic), and so does a top-level `slug` in REST POST/PATCH bodies. Hand-set slugs are normalized, refused with `CONFLICT` when taken, and no longer follow `slugFrom`. On a published document, a slug change saved as a draft stays pending until the next publish, so the live URL never changes early. The admin's Publishing panel gets a slug editor with a live preview, "Use automatic", and a note while a change awaits publishing. `slugify` moves to an isomorphic module (still exported from `xenon-cms/server`).
