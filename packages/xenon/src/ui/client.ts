/**
 * Client barrel → `xenon-cms/client` (internal). Bundled into a single `"use client"` module.
 * Server code must import client components ONLY via the "xenon-cms/client" specifier.
 * Zero `next/*` imports — works in any React 19 host (Next.js, Astro, TanStack Start, SPA).
 */
export { AdminProvider, useAdmin } from "./shared/admin-context";
export {
  AdminLink,
  AdminRouterContext,
  AdminRouterProvider,
  createHistoryRouter,
  defaultHistoryRouter,
  useAdminPathname,
  useAdminRouter,
} from "./shared/router";
export type {
  AdminLinkProps,
  AdminNavigateOptions,
  AdminRouter,
  HistoryRouterOptions,
} from "./shared/router";
export { AdminRoot } from "./admin/root";
export type { AdminRootProps } from "./admin/root";
export { createHttpAdminAction, fetchAdminData, useAdminRuntime } from "./admin/runtime";
export type { AdminAction, AdminTheme } from "./admin/runtime";
export { AuthScreen } from "./admin/auth-screen";
export { DashboardView } from "./admin/dashboard";
export { CollectionListView } from "./admin/collection-list";
export type { CollectionListViewProps, ListRow } from "./admin/collection-list";
export { SettingsView } from "./admin/settings";
export { DocumentEditor } from "./form/document-editor";
export { GlobalEditor } from "./form/global-editor";
export { PreviewSplitPane } from "./form/preview-pane";
export type { PreviewSplitPaneProps, PreviewViewport } from "./form/preview-pane";
