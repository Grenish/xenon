/**
 * Deep-copies a JSON-compatible value into plain objects/arrays (`Object.prototype` / `Array.prototype`).
 *
 * Why this exists: ProseMirror builds node/mark `attrs` with `Object.create(null)`, and Tiptap's
 * `getJSON()` hands those objects out as-is. React's Server Action argument encoder only serializes
 * plain objects — anything with a null (or custom) prototype is replaced by an opaque temporary
 * reference, so the server silently receives the node without its `attrs` (heading levels, link
 * hrefs, image sources…). Everything that crosses the action boundary must go through this.
 */
export function toPlainJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => toPlainJson(item)) as T;
  if (value instanceof Date) return value.toISOString() as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const item = toPlainJson((value as Record<string, unknown>)[key]);
    if (item !== undefined) out[key] = item;
  }
  return out as T;
}
