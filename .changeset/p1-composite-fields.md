---
"xenon-cms": minor
---

Composite and essential fields: `date()`, `datetime()`, `email()`, `url()`, `json({ schema })`, `group()`, `array()`, and `defineBlock()` + `blocks()`, with full type inference, nested validation and defaults, and admin inputs (drag-to-reorder rows, a block picker, nested error paths). Boolean fields can use `admin.display: "checkbox"`. In the title/body editor layout, `blocks` fields and fields with `admin.position: "main"` render under the body. Partial updates now merge `group` values recursively (arrays, blocks and `json` are replaced), and stored data is trimmed to the current schema before an update, so removing a nested field or block type no longer breaks updates to existing documents.
