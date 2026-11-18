/** Keys are relative paths. Encode segments separately so literal ?/#/% remain part of the key. */
export function keySegments(key: string): string[] {
  const segments = key.split("/");
  if (!key || /^[a-z]:/i.test(key) || key.includes("\\") || key.includes("\0") ||
    segments.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`[xenon] Unsafe storage key: ${JSON.stringify(key)}`);
  }
  return segments;
}

export function encodeKey(key: string): string {
  return keySegments(key).map(encodeURIComponent).join("/");
}
