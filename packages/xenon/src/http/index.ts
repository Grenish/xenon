/**
 * `xenon-cms/http` — framework-agnostic Web Standard HTTP handler, REST query parser,
 * HTTP caching helpers, and shared server-side admin loader & action dispatcher.
 */
export { createHandler, extractRouteSegments, handleApiSegments, requireTrustedOrigin } from "./handler";
export type { CreateHandlerOptions, XenonHttpHandler } from "./handler";
export { parseDraft, parsePopulate, parseQuery, parseReadQuery, parseSelect, parseWhere } from "./query";
export type { ParsedQuery, ParsedReadQuery } from "./query";
export {
  computeEtag,
  DEFAULT_PUBLIC_CACHE_CONTROL,
  jsonCachedResponse,
  matchesIfNoneMatch,
  PRIVATE_NO_STORE,
} from "./cache";
export type { JsonCacheOptions } from "./cache";
export {
  canReadCollection,
  canReadGlobal,
  filterReadableCollections,
  filterReadableGlobals,
  loadAdminData,
  parseAdminPath,
  parseThemeCookie,
  resolveAdminSort,
  unpublishedChangesOnPage,
} from "./admin-loader";
export type { AdminRouteData, AdminShellPayload, LoadAdminDataOptions } from "./admin-loader";
export {
  actionErrorStatus,
  claimSetup,
  countUsers,
  dispatchAdminAction,
  dispatchAdminActionWithHeaders,
  getHttpXenon,
  listAllUsers,
  loadAdminDoc,
  loadAdminGlobal,
  mergeSessionHeaders,
  summaryTitle,
  titleFieldKey,
  toAdminDoc,
  toSummary,
} from "./admin-action";
export type {
  AdminActionExecution,
  AdminActionInput,
  AdminActionResult,
  DispatchAdminActionOptions,
} from "./admin-action";
export { loadDashboard } from "./dashboard-data";
export type { ClientCollection, ClientField, ClientGlobal } from "../ui/shared/client-config";
export type {
  AccountSession,
  ActionResult,
  AdminDoc,
  AdminListRow,
  AdminTeamMember,
  AdminTheme,
  AdminUserInfo,
  DashboardCollection,
  DashboardData,
  DashboardDoc,
  DashboardMedia,
  DocSummary,
  SearchInput,
  SearchResult,
  SettingsTab,
} from "../ui/shared/services";
