import type { WhereOperators } from "./types";

/*
 * Pure, in-process evaluation of the adapter `Where` operators (CONTRACTS §2.1), mirroring the
 * PostgreSQL compiler in `postgres/where.ts`. Used by `memoryAdapter` and by the Local API to
 * evaluate a field's `defaultValue` against a filter.
 */

/** Unicode scalar order, matching PostgreSQL COLLATE "C" for UTF-8 data. */
export function compareStrings(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}

/** Orders two values of the same primitive type (`false < true`, like PostgreSQL); `null` otherwise. */
export function compareValues(left: unknown, right: unknown): number | null {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return compareStrings(left, right);
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return null;
}

export function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right || left == null && right == null) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => deepEquals(item, right[index]));
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && deepEquals(a[key], b[key]));
}

/** Never equal to, nor comparable with, anything: an unparseable date operand matches nothing. */
const INVALID_DATE = Symbol("invalid date");

/** Normalizes a timestamp operand to the canonical ISO form stored values use (like `toDate` in where.ts). */
function dateOperand(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : INVALID_DATE;
}

/**
 * Whether `value` satisfies every operator. `date` marks the `createdAt`/`updatedAt` columns, whose
 * values are canonical ISO strings: operands are parsed as instants (any offset/precision), and
 * `contains` never matches (as in PostgreSQL).
 */
export function matchesOperators(value: unknown, operators: WhereOperators, date = false): boolean {
  const operand = (v: unknown) => (date ? dateOperand(v) : v);
  for (const [operator, original] of Object.entries(operators)) {
    if (original === undefined) continue;
    switch (operator) {
      case "equals": if (!deepEquals(value, operand(original))) return false; break;
      case "not_equals": if (deepEquals(value, operand(original))) return false; break;
      case "in":
      case "not_in": {
        if (!Array.isArray(original)) return false;
        const included = original.some((item) => deepEquals(value, operand(item)));
        if (operator === "in" ? !included : included) return false;
        break;
      }
      case "contains":
        if (date) return false;
        if (Array.isArray(value)) { if (!value.some((item) => deepEquals(item, original))) return false; }
        else if (!(typeof value === "string" && typeof original === "string" && value.toLowerCase().includes(original.toLowerCase()))) return false;
        break;
      case "exists": if ((value != null) !== original) return false; break;
      case "gt": case "gte": case "lt": case "lte": {
        const expected = operand(original);
        // Range filters compare numbers and strings only (booleans are sortable, not range-filterable).
        const comparison = typeof value === "boolean" ? null : compareValues(value, expected);
        if (comparison === null || (operator === "gt" && comparison <= 0) ||
          (operator === "gte" && comparison < 0) || (operator === "lt" && comparison >= 0) ||
          (operator === "lte" && comparison > 0)) return false;
        break;
      }
      default: return false;
    }
  }
  return true;
}
