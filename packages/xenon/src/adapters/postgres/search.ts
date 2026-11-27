import { type SQL, sql } from "drizzle-orm";
import { extractPrefixTokens, hasWebsearchOperators } from "../search";
import type { FindArgs } from "../types";
import { xenonDocuments as t } from "./schema";

/**
 * Compiles a user search query to a PostgreSQL `tsquery` using the `'simple'` dictionary.
 * - Queries containing websearch syntax (`"phrase"`, `OR`, `-term`) compile via `websearch_to_tsquery`.
 * - Plain term queries compile to prefix-enabled `to_tsquery('simple', 'tok1:* & tok2:*')` so typing
 *   partial words hits the GIN index cleanly.
 */
export function compileSearchQuery(raw: string | undefined): SQL | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (hasWebsearchOperators(trimmed)) {
    return sql`websearch_to_tsquery('simple', ${trimmed})`;
  }
  const tokens = extractPrefixTokens(trimmed);
  if (tokens.length === 0) {
    // Punctuation-only query yields an empty tsquery (0 matches, never a syntax error).
    return sql`websearch_to_tsquery('simple', ${trimmed})`;
  }
  const expr = tokens.map((token) => `${token}:*`).join(" & ");
  return sql`to_tsquery('simple', ${expr})`;
}

/**
 * Matches against `search_vector` for published reads (never leaking pending draft text)
 * and against `draft_search_vector ?? search_vector` for draft reads (using both GIN indexes).
 */
export function compileSearchFilter(source: FindArgs["source"], tsQuery: SQL): SQL {
  if (source === "published") {
    return sql`(${t.searchVector} @@ ${tsQuery})`;
  }
  return sql`((${t.draftSearchVector} is not null and ${t.draftSearchVector} @@ ${tsQuery}) or (${t.draftSearchVector} is null and ${t.searchVector} @@ ${tsQuery}))`;
}

/** Default relevance ordering when `search` is active and no explicit `sort` is supplied. */
export function compileSearchRankOrder(source: FindArgs["source"], tsQuery: SQL): SQL {
  const vec = source === "draft" ? sql`coalesce(${t.draftSearchVector}, ${t.searchVector})` : sql`${t.searchVector}`;
  return sql`ts_rank(${vec}, ${tsQuery}) desc, ${t.createdAt} desc, ${t.id} collate "C" asc`;
}
