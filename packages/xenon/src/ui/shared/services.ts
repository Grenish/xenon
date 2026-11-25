/**
 * Contract between the admin shell (server + client glue, owned by the coordinator) and the UI
 * feature components (DocumentEditor, fields). Components get these through `useAdmin()`.
 * Isomorphic types only.
 */
import type { DocumentStatus, XenonRole } from "../../core/types";
import type { ValidationIssue } from "../../core/validation";
import type { ClientCollection } from "./client-config";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; issues?: ValidationIssue[] } };

/** A document as the admin sees it: the working copy (`draftData ?? data`) plus meta. */
export interface AdminDoc {
  id: string;
  slug: string | null;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  /** Published doc with unpublished changes in its working copy. */
  hasUnpublishedChanges: boolean;
  /** The slug currently in use (differs from `slug` while a slug change awaits publishing). */
  liveSlug?: string | null;
  /** The slug was set by hand and no longer follows `slugFrom`. */
  slugManual?: boolean;
  /** Field values of the working copy (+ upload metadata for upload collections). */
  data: Record<string, unknown>;
}

/** Lightweight row for lists, pickers and relation chips. */
export interface DocSummary {
  id: string;
  title: string;
  status: DocumentStatus;
  updatedAt: string;
  /** Upload collections: file URL (images can be previewed). */
  url?: string | null;
  mimeType?: string | null;
  filename?: string | null;
}

export interface SearchInput {
  collection: string;
  query?: string;
  /** Restrict results and pagination totals to uploads with an image MIME type. */
  imagesOnly?: boolean;
  page?: number;
  limit?: number;
  /** Resolve exactly these ids (order preserved, missing ids omitted). */
  ids?: string[];
}

/** Display the same title in search results and immediately after an upload. */
export function documentSummaryTitle(data: Record<string, unknown>, titleKey: string | null | undefined, fallback = "Untitled"): string {
  const title = titleKey ? data[titleKey] : undefined;
  if (typeof title === "string" && title.trim()) return title;
  return typeof data.filename === "string" && data.filename.trim() ? data.filename : fallback;
}

export interface SearchResult {
  docs: DocSummary[];
  totalDocs: number;
  page: number;
  hasNextPage: boolean;
}

export interface AdminServices {
  /** Create (no `id`) or update. `draft: true` = save draft, otherwise publish. */
  /** `slug`: a string sets it by hand, `null` switches back to automatic, omitted leaves it alone. */
  save(input: { collection: string; id?: string; data: Record<string, unknown>; draft: boolean; expectedUpdatedAt?: string; slug?: string | null }): Promise<ActionResult<AdminDoc>>;
  /** Fresh copy of one document (after someone else saved it). */
  get(input: { collection: string; id: string }): Promise<ActionResult<AdminDoc>>;
  unpublish(input: { collection: string; id: string }): Promise<ActionResult<AdminDoc>>;
  remove(input: { collection: string; id: string }): Promise<ActionResult<{ id: string }>>;
  search(input: SearchInput): Promise<ActionResult<SearchResult>>;
  /** Upload to an upload collection (create, or replace the file when `id` is given). */
  upload(input: { collection: string; id?: string; file: File; data: Record<string, unknown>; expectedUpdatedAt?: string }): Promise<ActionResult<AdminDoc>>;
}

export interface AdminUserInfo {
  id: string;
  email: string;
  name: string | null;
  role: XenonRole;
}

export type AdminTheme = "light" | "dark" | "system";

export interface AdminListRow extends DocSummary {
  changed?: boolean;
  values: Record<string, unknown>;
}

export interface AdminTeamMember extends AdminUserInfo {
  createdAt: string;
}

export interface AdminContextValue {
  /** e.g. `/admin` */
  basePath: string;
  /** e.g. `/api/xenon` */
  apiPath: string;
  collections: ClientCollection[];
  user: AdminUserInfo;
  services: AdminServices;
}

/** Admin URL helpers (keep in sync with the shared admin loader in src/http/admin-loader). */
/** Dashboard payload (built on the server by `loadDashboard`). */
export interface DashboardDoc {
  id: string;
  collection: string;
  title: string;
  status: DocumentStatus;
  /** Published, with unpublished changes in its working copy. */
  changed: boolean;
  updatedAt: string;
}
export interface DashboardCollection {
  slug: string;
  total: number;
  published: number;
  drafts: number;
  changed: number;
  /** Upload collections: total file size in bytes; otherwise null. */
  bytes: number | null;
}
export interface DashboardMedia {
  id: string;
  collection: string;
  url: string;
  alt: string;
  updatedAt: string;
}
export interface DashboardData {
  collections: DashboardCollection[];
  /** Latest images across upload collections, newest first. */
  media: DashboardMedia[];
  recent: DashboardDoc[];
  attention: DashboardDoc[];
  attentionTotal: number;
  /** ISO timestamps within the last `days` days (last edit per document / creation). */
  activity: { days: number; edited: string[]; created: string[] };
}

export type SettingsTab = "profile" | "appearance" | "team";

/** A signed-in session of the current user (no token: revocation is resolved on the server by id). */
export interface AccountSession {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export const adminRoutes = {
  dashboard: (base: string) => base,
  list: (base: string, collection: string) => `${base}/collections/${collection}`,
  create: (base: string, collection: string) => `${base}/collections/${collection}/new`,
  edit: (base: string, collection: string, id: string) => `${base}/collections/${collection}/${id}`,
  settings: (base: string, tab: SettingsTab = "profile") => (tab === "profile" ? `${base}/settings` : `${base}/settings/${tab}`),
  users: (base: string) => `${base}/settings/team`,
  account: (base: string) => `${base}/settings`,
  login: (base: string) => `${base}/login`,
  setup: (base: string) => `${base}/setup`,
} as const;
