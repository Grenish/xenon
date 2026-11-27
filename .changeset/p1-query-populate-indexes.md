---
"xenon-cms": minor
---

Typed batched `populate`, `select` projection, nested `where` and opt-in field indexes (#11):

- `find`, `findById` and `findBySlug` accept `populate` (an explicit tree over `relation` / `media` fields, including ones inside `group`, `array` and `blocks`, with nested `select` / `populate` per relation) and `select` (an inclusion projection). Return types are inferred from both. Population is batched: one query per target collection per depth level, with no N+1, and it checks `access.read` on every populated collection.
- REST supports the same options: `?populate[author]=true`, `?populate=author,cover`, `?select=title,slug`, `?select[seo][noIndex]=true`, or JSON values. Responses that populate a read-restricted collection are not publicly cached.
- `where` and `sort` accept dot paths into `group` fields (`"seo.noIndex"`) in the Postgres and memory adapters.
- Fields accept `index: true` and `unique: true`. On Postgres, `init()` creates matching expression indexes and partial unique indexes. Duplicate values throw `CONFLICT` with the field path. New export: `UniqueConflictError`.
