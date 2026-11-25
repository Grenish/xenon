import { matchesOperators } from "../adapters/match";
import type { WhereOperators } from "../adapters/types";
import type { FieldCondition } from "./types";

export const CONDITION_OPERATORS = new Set(["equals", "not_equals", "in", "not_in", "contains", "gt", "gte", "lt", "lte", "exists"]);

/**
 * Evaluates an `admin.condition` against the field's sibling data (the object that holds the field:
 * the document, a group, an array row or a block). Same operators and semantics as `where`.
 * Isomorphic and dependency-free: the admin runs it as you type, the server when validating.
 */
export function evaluateCondition(condition: FieldCondition, siblings: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(condition)) {
    if (value === undefined) continue;
    if (key === "and") {
      if (!(value as FieldCondition[]).every((part) => evaluateCondition(part, siblings))) return false;
    } else if (key === "or") {
      if (!(value as FieldCondition[]).some((part) => evaluateCondition(part, siblings))) return false;
    } else if (!matchesOperators(Object.hasOwn(siblings, key) ? siblings[key] : null, value as WhereOperators)) {
      return false;
    }
  }
  return true;
}

/** Whether a field with this `admin.condition` is shown (no condition → always). */
export function isConditionMet(condition: FieldCondition | undefined, siblings: Record<string, unknown>): boolean {
  return condition === undefined || evaluateCondition(condition, siblings);
}
