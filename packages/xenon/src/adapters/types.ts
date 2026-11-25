/**
 * Adapter contracts (Phase 2). Semantics are specified in docs/CONTRACTS.md §2 and enforced by
 * the shared conformance suite in test/adapters/. Change only via the coordinator.
 */
import type { BetterAuthOptions } from "better-auth";
import type { DocumentStatus } from "../core/types";

/* -------------------------------------------------------------------------- */
/*                                  Database                                  */
/* -------------------------------------------------------------------------- */

/** A raw row of the polymorphic `xenon_documents` table. */
export interface DocumentRecord {
  id: string;
  collection: string;
  slug: string | null;
  status: DocumentStatus;
  /** Live (published) data. `{}` for documents that were never published. */
  data: Record<string, unknown>;
  /** Unpublished working copy, or `null` when there are no pending changes. */
  draftData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhereOperators {
  equals?: unknown;
  not_equals?: unknown;
  in?: readonly unknown[];
  not_in?: readonly unknown[];
  contains?: unknown;
  gt?: number | string;
  gte?: number | string;
  lt?: number | string;
  lte?: number | string;
  exists?: boolean;
}

/**
 * Filter. Keys are system keys (`id`, `slug`, `status`, `createdAt`, `updatedAt`) or top-level
 * data field names. Sibling keys and sibling operators are ANDed.
 */
export type Where = {
  and?: Where[];
  or?: Where[];
} & { [field: string]: WhereOperators | Where[] | undefined };

export interface FindArgs {
  collection: string;
  /**
   * `published`: only `status = "published"` documents, fields read from `data`.
   * `draft`: all documents, fields read from `draftData ?? data`.
   */
  source: "published" | "draft";
  where?: Where;
  /** Field or system key; `-` prefix = descending. Default `-createdAt`. Ties broken by `id`. */
  sort?: string;
  /** Default 10. `0` = no limit. */
  limit?: number;
  /** 1-based. Default 1. */
  page?: number;
}

export interface PaginatedResult<T> {
  docs: T[];
  totalDocs: number;
  limit: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface CreateRecordInput {
  collection: string;
  slug: string | null;
  status: DocumentStatus;
  data: Record<string, unknown>;
  draftData: Record<string, unknown> | null;
}

export type UpdateRecordInput = Partial<Omit<CreateRecordInput, "collection">>;

export interface UpdateRecordOptions {
  /**
   * Optimistic concurrency: only update when the row's `updatedAt` still equals this instant.
   * Checked in the same statement as the write (no extra query on success).
   */
  ifUpdatedAt?: Date;
}

/** Thrown by adapters when `ifUpdatedAt` no longer matches: someone else saved in between. */
export class UpdateConflictError extends Error {
  override name = "UpdateConflictError";
  constructor(
    public readonly collection: string,
    public readonly id: string,
  ) {
    super(`[xenon] Document "${id}" in "${collection}" was changed by another save.`);
  }
}

/** Thrown by adapters when `(collection, slug)` would no longer be unique. */
export class SlugConflictError extends Error {
  override name = "SlugConflictError";
  constructor(
    public readonly collection: string,
    public readonly slug: string,
  ) {
    super(`[xenon] Slug "${slug}" is already used in collection "${collection}".`);
  }
}

export interface SummarizeArgs {
  collection: string;
  /** Start of the activity window for `edited` / `created`. */
  since: Date;
  /** How many most recently edited records to return in `recent`. */
  recent: number;
  /** How many records needing attention to return, oldest edit first. */
  attention: number;
  /** How many most recently edited image records (working-copy `mimeType` `image/*`) to return. */
  images: number;
}

/**
 * Admin dashboard figures for one collection. The "working copy" of a record is `draftData ?? data`.
 * A record "needs attention" when it is a draft or published with a pending `draftData`.
 */
export interface CollectionSummary {
  total: number;
  published: number;
  drafts: number;
  /** Published records with a pending `draftData`. */
  changed: number;
  /** Sum of numeric working-copy `filesize` values. */
  bytes: number;
  /** `updatedAt` of every record edited at or after `since`. */
  edited: Date[];
  /** `createdAt` of every record created at or after `since`. */
  created: Date[];
  /** Newest `updatedAt` first, ties by `id`. */
  recent: DocumentRecord[];
  /** Oldest `updatedAt` first, ties by `id`. */
  attention: DocumentRecord[];
  attentionTotal: number;
  /** Newest `updatedAt` first, ties by `id`. */
  images: DocumentRecord[];
}

export interface DatabaseAdapter {
  readonly name: string;
  /** Idempotent: create tables/indexes if missing. Called once before first use. */
  init(): Promise<void>;
  find(args: FindArgs): Promise<PaginatedResult<DocumentRecord>>;
  findById(collection: string, id: string): Promise<DocumentRecord | null>;
  /** Generates `id` and timestamps. Throws `SlugConflictError` on duplicate slug. */
  create(input: CreateRecordInput): Promise<DocumentRecord>;
  /**
   * Bumps `updatedAt` strictly (at least 1 ms past the previous value), so `updatedAt` doubles as the
   * row's version. Returns `null` when not found. Throws `SlugConflictError` on duplicate slug and
   * `UpdateConflictError` when `options.ifUpdatedAt` no longer matches.
   */
  update(collection: string, id: string, input: UpdateRecordInput, options?: UpdateRecordOptions): Promise<DocumentRecord | null>;
  /** Returns `false` when not found. */
  delete(collection: string, id: string): Promise<boolean>;
  /**
   * Returns the BetterAuth `database` option for this backend, after ensuring the auth tables
   * described by `authOptions` exist. Called once, after `init()`.
   */
  getAuthDatabase(authOptions: BetterAuthOptions): Promise<NonNullable<BetterAuthOptions["database"]>>;
  /**
   * Optional fast path for the admin dashboard (aggregates in the database instead of loading every
   * document). When absent, Xenon computes the same figures with `summarizeRecords` over `find`.
   */
  summarize?(args: SummarizeArgs): Promise<CollectionSummary>;
  /** Release connections (tests, scripts). */
  close?(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*                                  Presence                                  */
/* -------------------------------------------------------------------------- */

/** Who is where in the admin. Isomorphic, type-only. */
export interface PresenceUser {
  id: string;
  name: string | null;
  email: string;
}

export interface PresenceLocation {
  collection: string;
  /** Document id; omitted on a collection list. */
  id?: string;
  /** Document title as the client shows it (for "Tom is editing …"). */
  title?: string;
}

export interface PresenceBeat {
  /** Random id of one browser tab. */
  tab: string;
  user: PresenceUser;
  location: PresenceLocation | null;
  /** `edit` asks for the document's soft lock; `takeover` takes it from whoever holds it. */
  intent: "view" | "edit" | "takeover";
  /** `updatedAt` of the document version this tab has (lets viewers notice a newer save). */
  version?: string;
}

export interface PresencePeer {
  tab: string;
  user: PresenceUser;
  location: PresenceLocation | null;
  /** Holds the soft lock of `location.id`. */
  editing: boolean;
  version: string | null;
  /** When this tab arrived at its location (ms). */
  since: number;
}

export interface PresenceSnapshot {
  you: {
    editing: boolean;
    /** Set when someone took the lock from this tab; cleared once the tab sends `view` or `takeover`. */
    takenOverBy: { user: PresenceUser; at: number } | null;
  };
  /** Every other active tab (including this user's other tabs). */
  peers: PresencePeer[];
}

/**
 * Where presence lives. The default keeps it in server memory (no database traffic). Multi-instance
 * deployments that want one shared view can plug in a store backed by Redis or similar; the store
 * owns lock resolution, so it must apply each beat atomically.
 */
export interface PresenceStore {
  readonly name: string;
  beat(beat: PresenceBeat): Promise<PresenceSnapshot> | PresenceSnapshot;
  leave(userId: string, tab: string): Promise<void> | void;
}

/* -------------------------------------------------------------------------- */
/*                                   Storage                                  */
/* -------------------------------------------------------------------------- */

export interface UploadFileInput {
  /** Storage key, e.g. `media/2026/11/k3j2h-photo.jpg`. Generated by the Local API. */
  key: string;
  body: Uint8Array;
  contentType: string;
  size: number;
}

export interface StoredFile {
  body: Uint8Array | ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
}

export interface PresignedUploadInput {
  /** Storage key, e.g. `media/2026/11/k3j2h-photo.jpg`. Generated by the Local API. */
  key: string;
  /** Declared MIME type enforced on the presigned upload. */
  contentType: string;
  /** Expected file size in bytes (signed when supported so storage rejects mismatched sizes). */
  size?: number;
  /** Presigned URL lifetime in seconds (default 900). */
  expiresIn?: number;
}

export interface PresignedUploadResult {
  /** Storage key the presigned request writes to. */
  key: string;
  /** Direct-to-storage presigned URL. */
  url: string;
  /** HTTP method the client must use (`"PUT"` for S3/R2). */
  method: "PUT" | "POST";
  /** Headers the client must send with the direct upload request. */
  headers: Record<string, string>;
  /** ISO-8601 timestamp when the presigned URL expires. */
  expiresAt: string;
}

export interface StoredFileHead {
  /** Exact object size in bytes (`Content-Length`). */
  size: number;
  /** Object `Content-Type` reported by storage, or `null`. */
  contentType: string | null;
  /** Object `ETag` reported by storage, or `null`. */
  etag?: string | null;
}

export interface StorageAdapter {
  readonly name: string;
  upload(file: UploadFileInput): Promise<{ key: string; url: string }>;
  /** Must not throw when the key does not exist. */
  delete(key: string): Promise<void>;
  /** Public URL for a stored key. */
  getUrl(key: string): string;
  /**
   * Optional: stream a stored file. Adapters without a public origin (local disk) implement this;
   * the REST handler then serves files at `{api.path}/_files/{key}`.
   */
  read?(key: string): Promise<StoredFile | null>;
  /**
   * Optional: mint a short-lived direct upload URL (e.g. S3/R2 SigV4 presigned PUT).
   * Adapters implementing this should also implement `head` and `readRange` so `_complete`
   * can enforce size, magic-byte, active-content, and image-dimension checks before saving.
   */
  createPresignedUpload?(input: PresignedUploadInput): Promise<PresignedUploadResult>;
  /** Optional: read an object's metadata (`Content-Length`, `Content-Type`) without downloading it. Returns `null` on 404. */
  head?(key: string): Promise<StoredFileHead | null>;
  /**
   * Optional: read an inclusive byte range `[start, end]` from a stored object for magic-byte
   * sniffing, active-markup blocking, and image dimension detection. Returns `null` on 404.
   */
  readRange?(key: string, start: number, end: number): Promise<Uint8Array | null>;
}
