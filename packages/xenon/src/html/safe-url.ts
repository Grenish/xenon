const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Validates and normalizes a URL for safe use in `<a href>` / `<img src>`.
 * Permits `http:`, `https:`, `mailto:`, `tel:`, and relative paths; rejects
 * control-character obfuscation, protocol-relative URLs, and unsafe schemes.
 */
export function safeUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  // Reject empty strings and C0/DEL control characters (browsers strip \t/\n/\r and leading controls when parsing schemes).
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  // Reject protocol-relative URLs (`//evil.com`, `/\evil.com`) and leading backslashes.
  if (/^([/\\]{2}|\\)/.test(trimmed)) return undefined;
  if (SCHEME_RE.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return undefined;
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !/^https?:\/\//i.test(trimmed)) return undefined;
      return trimmed;
    } catch {
      return undefined;
    }
  }
  return trimmed;
}
