/** A short random id for `array` rows and `blocks` items (16 hex chars). Isomorphic, dependency-free. */
export function newRowId(): string {
  // getRandomValues (unlike randomUUID) also works in browsers on insecure (plain-http) origins.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
