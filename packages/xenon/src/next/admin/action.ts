import { cookies, headers as nextHeaders } from "next/headers";
import type { XenonConfig } from "../../core/types";
import {
  type AdminActionInput,
  type AdminActionResult,
  claimSetup,
  countUsers,
  dispatchAdminAction as dispatchCoreAdminAction,
  listAllUsers,
  loadAdminDoc,
  mergeSessionHeaders,
  summaryTitle,
  titleFieldKey,
  toAdminDoc,
  toSummary,
} from "../../http/admin-action";
import { getXenon } from "../xenon";

export {
  claimSetup,
  countUsers,
  listAllUsers,
  loadAdminDoc,
  mergeSessionHeaders,
  summaryTitle,
  titleFieldKey,
  toAdminDoc,
  toSummary,
};
export type { AdminActionInput, AdminActionResult };

export async function sessionRequestHeaders(): Promise<Headers> {
  const [headers, cookieStore] = await Promise.all([nextHeaders(), cookies()]);
  return mergeSessionHeaders(headers, cookieStore.toString());
}

/**
 * Dispatches an admin action. Call it from a user-land `"use server"` function:
 * `async function action(input) { "use server"; return runAdminAction(config, input); }`
 */
export async function runAdminAction(config: XenonConfig, input: AdminActionInput): Promise<AdminActionResult> {
  return dispatchAdminAction(config, input, await sessionRequestHeaders());
}

/** Internal dispatcher taking explicit headers, bound to Next's memoized `getXenon(config)`. */
export async function dispatchAdminAction(
  config: XenonConfig,
  input: AdminActionInput,
  headers: Headers,
): Promise<AdminActionResult> {
  return dispatchCoreAdminAction(config, input, headers, { xenon: getXenon(config) });
}
