---
"xenon-cms": minor
---

Collection and field lifecycle hooks (#12):

- `defineCollection({ hooks })` accepts `beforeValidate`, `beforeChange`, `afterChange`, `afterRead`, `beforeDelete` and `afterDelete`. Each is one function or an array, typed from the collection's fields. Fields accept `hooks` with `beforeValidate`, `beforeChange`, `afterChange` and `afterRead`. Field hooks run inside `group`, `array` and `blocks` values and receive `value`, `siblingData` and `path`.
- Hooks run for every write through the Local API, so REST, the admin UI and presigned uploads are covered too. The order is: access check, `beforeValidate`, validation, `beforeChange`, write, `onChange`, `afterChange`, `afterRead`. `afterRead` also runs on populated documents, before `select`. Throw a `XenonError` from a hook to reject an operation with that status. `afterChange` and `afterDelete` errors reach the caller, but the write has already been committed.
- Hooks receive `{ data | doc, originalDoc | previousDoc, operation, draft, user, collection, context, xenon }`. Local API calls take a new `context` option, a mutable object shared by every hook in that call. The `xenon` passed to hooks forwards `context` to nested calls and fails once calls are nested more than 16 levels deep, so a hook that keeps re-triggering itself errors instead of looping forever.
- `CollectionBySlug` (and therefore an untyped `XenonInstance`) now resolves any slug to the loose collection type instead of `never` when the config is erased.
