---
"xenon-cms": minor
---

`admin.condition` shows a field only when its sibling data matches, using the `where` operators (`{ kind: { equals: "video" } }`, with `and` / `or`). The admin shows and hides fields as you type; the server applies the same rule, so hidden fields skip `required`, row minimums and custom `validate` while their values are still type-checked. Conditions are validated in `defineConfig` (sibling keys, known operators, plain JSON). New export: `evaluateCondition`.
