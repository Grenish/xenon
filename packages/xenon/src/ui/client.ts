/**
 * Client barrel → `xenon-cms/client` (internal). Bundled into a single `"use client"` module.
 * Server code must import client components ONLY via the "xenon-cms/client" specifier.
 */
export { AdminProvider, useAdmin } from "./shared/admin-context";
export { AdminRoot } from "./admin/root";
export { AuthScreen } from "./admin/auth-screen";
export { DashboardView } from "./admin/dashboard";
export { CollectionListView } from "./admin/collection-list";
export { SettingsView } from "./admin/settings";
export { DocumentEditor } from "./form/document-editor";
