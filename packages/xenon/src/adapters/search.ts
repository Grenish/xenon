import { richTextToPlainText } from "../html/rich-text";
import type { RichTextDocument } from "../core/types";

const TOKEN_SPLIT_RE = /[^\p{L}\p{N}]+/gu;
const MAX_QUERY_TOKENS = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectFallbackStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 16 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFallbackStrings(item, out, depth + 1);
    return;
  }
  if (isRecord(value)) {
    if (value.type === "doc" && Array.isArray(value.content)) {
      const plain = richTextToPlainText(value as unknown as RichTextDocument).trim();
      if (plain) out.push(plain);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key.startsWith("_")) continue;
      collectFallbackStrings(entry, out, depth + 1);
    }
  }
}

/**
 * Schema-less fallback search text extractor used when an adapter's `create` / `update` is called
 * directly without precomputed `searchText` / `draftSearchText`.
 */
export function fallbackSearchText(
  slug: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
): string {
  const parts: string[] = [];
  if (typeof slug === "string" && slug.trim()) parts.push(slug.trim());
  if (data) collectFallbackStrings(data, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Lowercase Unicode alphanumeric tokens (safe for both Postgres `to_tsquery` and memory matching). */
export function tokenizeSearchText(input: string): string[] {
  return input
    .toLowerCase()
    .split(TOKEN_SPLIT_RE)
    .filter((token) => token.length > 0);
}

/** Detects Postgres `websearch_to_tsquery` syntax (quoted phrases, `OR`, or `-excluded` terms). */
export function hasWebsearchOperators(query: string): boolean {
  return query.includes('"') || /\sOR\s/.test(query) || /(?:^|\s)-\S/.test(query);
}

/** Safe, deduped token list capped to prevent pathological query plans. */
export function extractPrefixTokens(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokenizeSearchText(query)) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= MAX_QUERY_TOKENS) break;
  }
  return out;
}

interface SearchAtom {
  kind: "prefix" | "word" | "phrase";
  value: string;
  negated: boolean;
}

function parseBranchAtoms(branch: string, usePrefix: boolean): SearchAtom[] {
  const atoms: SearchAtom[] = [];
  const re = /(-?)"([^"]+)"|(-?)([^\s"]+)/g;
  for (let match = re.exec(branch); match; match = re.exec(branch)) {
    if (match[2] !== undefined) {
      const phrase = tokenizeSearchText(match[2]).join(" ");
      if (phrase) atoms.push({ kind: "phrase", value: phrase, negated: match[1] === "-" });
    } else if (match[4] !== undefined) {
      const negated = match[3] === "-";
      for (const tok of tokenizeSearchText(match[4])) {
        atoms.push({ kind: usePrefix && !negated ? "prefix" : "word", value: tok, negated });
      }
    }
  }
  return atoms;
}

/**
 * Portable full-text matcher & relevance scorer for `memoryAdapter`, mirroring Postgres
 * `tsvector` semantics:
 * - plain queries match every token as a case-insensitive word prefix (AND);
 * - websearch queries support `"quoted phrases"`, `OR`, and `-excluded` terms.
 * Returns `0` when the document does not match, or a positive score for relevance ranking.
 */
export function scoreMemorySearch(documentText: string, rawQuery: string): number {
  const query = rawQuery.trim();
  if (!query) return 1;

  const docTokens = tokenizeSearchText(documentText);
  const normalizedDoc = docTokens.join(" ");
  const websearch = hasWebsearchOperators(query);
  const branches = websearch ? query.split(/\s+OR\s+/) : [query];

  let bestScore = 0;
  let hadValidAtom = false;

  for (const branch of branches) {
    const atoms = parseBranchAtoms(branch, !websearch);
    if (atoms.length === 0) continue;
    hadValidAtom = true;

    let branchMatched = true;
    let branchScore = 0;
    for (const atom of atoms) {
      let hits = 0;
      if (atom.kind === "phrase") {
        // Match phrase on token boundaries in normalized space-delimited token stream.
        const paddedDoc = ` ${normalizedDoc} `;
        const needle = ` ${atom.value} `;
        let idx = paddedDoc.indexOf(needle);
        while (idx !== -1) {
          hits++;
          idx = paddedDoc.indexOf(needle, idx + atom.value.length);
        }
      } else if (atom.kind === "prefix") {
        for (const tok of docTokens) {
          if (tok.startsWith(atom.value)) hits += tok === atom.value ? 2 : 1;
        }
      } else {
        for (const tok of docTokens) {
          if (tok === atom.value) hits += 2;
        }
      }

      if (atom.negated) {
        if (hits > 0) {
          branchMatched = false;
          break;
        }
      } else {
        if (hits === 0) {
          branchMatched = false;
          break;
        }
        branchScore += Math.min(hits, 10);
      }
    }

    if (branchMatched) {
      // A branch containing only negated atoms matches with a minimal positive score.
      bestScore = Math.max(bestScore, branchScore > 0 ? branchScore : 1);
    }
  }

  return hadValidAtom ? bestScore : 0;
}
