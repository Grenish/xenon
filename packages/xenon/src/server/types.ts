/**
 * Local API surface (CONTRACTS §3). The REST handler and the admin UI build on this interface only.
 */
import type { PaginatedResult, StoredFile, VersionAuthor, VersionKind, Where } from "../adapters/types";
import type {
  AnyGlobal,
  GlobalBySlug,
  GlobalSlug,
  InferGlobalDraftInput,
  InferGlobalType,
  InferGlobalUpdateInput,
  InferQueryGlobalType,
  PopulateGlobalInput,
  SelectGlobalInput,
} from "../core/global";
import type {
  AnyCollection,
  CollectionBySlug,
  HookContext,
  CollectionSlug,
  InferCollectionType,
  InferCreateInput,
  InferDraftInput,
  InferQueryCollectionType,
  InferUpdateInput,
  PopulateInput,
  RuntimePopulate,
  RuntimeSelect,
  SelectInput,
  XenonConfig,
  XenonUser,
} from "../core/types";

export type XenonOperation = "create" | "update" | "delete";

export interface XenonChangeEvent {
  collection: string;
  /** Set when the change is to a global singleton (its global slug). */
  global?: string;
  id: string;
  op: XenonOperation | "unpublish";
  /** `true` when the write only touched the draft (`draft: true` save): published content is unchanged. */
  draft?: boolean;
}

export interface CreateXenonOptions {
  /** Called after every successful write (used by `xenon-cms/next` for revalidateTag). */
  onChange?: (event: XenonChangeEvent) => void | Promise<void>;
}

/** Common per-call options. */
export interface CallContext {
  /** Acting user; used when `overrideAccess` is `false`. */
  user?: XenonUser | null;
  /** Skip access control. Default `true` for the Local API, `false` in REST. */
  overrideAccess?: boolean;
  /** Mutable bag shared by every hook of this call (and nested calls made through the hooks' `xenon`). */
  context?: HookContext;
}

type Slug<Cfg> = CollectionSlug<Cfg> & string;
// Narrow via `infer … extends` (an `& AnyCollection` intersection would widen `fields` to an index signature).
type Coll<Cfg, S extends Slug<Cfg>> = CollectionBySlug<Cfg, S> extends infer C extends AnyCollection ? C : never;
export type DocOf<Cfg, S extends Slug<Cfg>> = InferCollectionType<Coll<Cfg, S>>;
export type QueryDocOf<Cfg, S extends Slug<Cfg>, Sel = undefined, Pop = undefined> = InferQueryCollectionType<
  Cfg,
  Coll<Cfg, S>,
  Sel,
  Pop
>;

type SelectArg<Cfg, S extends Slug<Cfg>> = string extends S ? RuntimeSelect : SelectInput<Coll<Cfg, S>>;
type PopulateArg<Cfg, S extends Slug<Cfg>> = string extends S ? RuntimePopulate : PopulateInput<Cfg, S>;

type GSlug<Cfg> = GlobalSlug<Cfg> & string;
type Glob<Cfg, S extends GSlug<Cfg>> = GlobalBySlug<Cfg, S> extends infer G extends AnyGlobal ? G : never;
export type GlobalDocOf<Cfg, S extends GSlug<Cfg>> = InferGlobalType<Glob<Cfg, S>>;
export type QueryGlobalDocOf<Cfg, S extends GSlug<Cfg>, Sel = undefined, Pop = undefined> = InferQueryGlobalType<
  Cfg,
  Glob<Cfg, S>,
  Sel,
  Pop
>;

type SelectGlobalArg<Cfg, S extends GSlug<Cfg>> = string extends Glob<Cfg, S>["slug"] ? RuntimeSelect : SelectGlobalInput<Glob<Cfg, S>>;
type PopulateGlobalArg<Cfg, S extends GSlug<Cfg>> = string extends Glob<Cfg, S>["slug"] ? RuntimePopulate : PopulateGlobalInput<Cfg, S>;

export interface GetGlobalOptions<
  Cfg,
  S extends GSlug<Cfg>,
  Sel extends SelectGlobalArg<Cfg, S> | undefined = undefined,
  Pop extends PopulateGlobalArg<Cfg, S> | undefined = undefined,
> extends CallContext {
  slug: S;
  /** Read working copy (`draftData ?? data`) even when not yet published. Default `false`. */
  draft?: boolean;
  /** Inclusion projection over returned global fields (`id` is always preserved). */
  select?: Sel;
  /** Explicit batched population of `relation` / `media` fields (zero N+1). */
  populate?: Pop;
}

export interface UpdateGlobalOptions<Cfg, S extends GSlug<Cfg>> extends CallContext {
  slug: S;
  data: InferGlobalUpdateInput<Glob<Cfg, S>> | InferGlobalDraftInput<Glob<Cfg, S>>;
  draft?: boolean;
  /**
   * Optimistic concurrency: the `updatedAt` of the version the caller edited. When the global has
   * been saved since, the update is refused with a `CONFLICT` error instead of overwriting.
   */
  expectedUpdatedAt?: string | Date;
}

export interface UnpublishGlobalOptions<Cfg, S extends GSlug<Cfg>> extends CallContext {
  slug: S;
}

export interface FindOptions<
  Cfg,
  S extends Slug<Cfg>,
  Sel extends SelectArg<Cfg, S> | undefined = undefined,
  Pop extends PopulateArg<Cfg, S> | undefined = undefined,
> extends CallContext {
  collection: S;
  where?: Where;
  /** Full-text search across text fields, rich text bodies, slug, and upload filename (Postgres `tsvector` GIN index; portable fallback in memory). */
  search?: string;
  sort?: string;
  limit?: number;
  page?: number;
  /** Read working copies (`draftData ?? data`) of all documents. Default `false`. */
  draft?: boolean;
  /**
   * List the trash instead (collections with `trash`): only trashed documents, read as working
   * copies (needs draft read access). Default `false`.
   */
  trash?: boolean;
  /** Inclusion projection over returned document fields (`id` is always preserved). */
  select?: Sel;
  /** Explicit batched population of `relation` / `media` fields (zero N+1). */
  populate?: Pop;
}

export interface FindByIdOptions<
  Cfg,
  S extends Slug<Cfg>,
  Sel extends SelectArg<Cfg, S> | undefined = undefined,
  Pop extends PopulateArg<Cfg, S> | undefined = undefined,
> extends CallContext {
  collection: S;
  id: string;
  draft?: boolean;
  /** Also return the document when it is in the trash (otherwise a trashed document reads as `null`). */
  trash?: boolean;
  /** Inclusion projection over returned document fields (`id` is always preserved). */
  select?: Sel;
  /** Explicit batched population of `relation` / `media` fields (zero N+1). */
  populate?: Pop;
}

export interface FindBySlugOptions<
  Cfg,
  S extends Slug<Cfg>,
  Sel extends SelectArg<Cfg, S> | undefined = undefined,
  Pop extends PopulateArg<Cfg, S> | undefined = undefined,
> extends CallContext {
  collection: S;
  slug: string;
  draft?: boolean;
  /** Inclusion projection over returned document fields (`id` is always preserved). */
  select?: Sel;
  /** Explicit batched population of `relation` / `media` fields (zero N+1). */
  populate?: Pop;
}

export interface UploadFile {
  data: Uint8Array | Blob;
  name: string;
  type: string;
}

export interface CreateOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  /** Validated in `draft` mode when `draft: true`, otherwise `create` mode. */
  data: InferCreateInput<Coll<Cfg, S>> | InferDraftInput<Coll<Cfg, S>>;
  draft?: boolean;
  /** Required for upload collections. */
  file?: UploadFile;
  /**
   * Set the slug by hand: normalized with `slugify`, and refused with `CONFLICT` (issue path `slug`)
   * if another document uses it. A hand-set slug no longer follows `slugFrom`. `null` switches back to
   * the automatic slug. On a published document, a draft save keeps the change pending: the live slug
   * changes when the document is next published.
   */
  slug?: string | null;
}

export interface UpdateOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  id: string;
  data: InferUpdateInput<Coll<Cfg, S>> | InferDraftInput<Coll<Cfg, S>>;
  draft?: boolean;
  /** Replace the stored file (upload collections). */
  file?: UploadFile;
  /**
   * Set the slug by hand: normalized with `slugify`, and refused with `CONFLICT` (issue path `slug`)
   * if another document uses it. A hand-set slug no longer follows `slugFrom`. `null` switches back to
   * the automatic slug. On a published document, a draft save keeps the change pending: the live slug
   * changes when the document is next published.
   */
  slug?: string | null;
  /**
   * Optimistic concurrency: the `updatedAt` of the version the caller edited. When the document has
   * been saved since, the update is refused with a `CONFLICT` error instead of overwriting.
   */
  expectedUpdatedAt?: string | Date;
  /**
   * A background draft save (admin autosave): with `draft: true`, the write does not create a
   * version (collections with `versions`). Ignored on publishes.
   */
  autosave?: boolean;
}

export interface ByIdOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  id: string;
}

export interface DuplicateOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  /** The document to copy. */
  id: string;
  /** Values to change on the copy (e.g. a new title), merged like an `update`. */
  data?: InferUpdateInput<Coll<Cfg, S>>;
}

/* ------------------------------- Versions (#15) ------------------------------- */

export type { VersionAuthor, VersionKind };

/** One saved version of a document. */
export interface DocumentVersion<Doc = Record<string, unknown>> {
  /** Version id. */
  id: string;
  documentId: string;
  /** `publish`: what went live; `draft`: a manual draft save; `restore`: a restored version. */
  kind: VersionKind;
  /** When the version was saved (ISO). */
  createdAt: string;
  author: VersionAuthor | null;
  /** The document as it was (field values read with current defaults; `updatedAt` = `createdAt`). */
  doc: Doc;
}

export interface FindVersionsOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  /** Document id. */
  id: string;
  /** Default 10, max 100. */
  limit?: number;
  page?: number;
}

export interface RestoreVersionOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  /** Version id. */
  id: string;
  /**
   * `true` (default when the collection uses drafts): the version becomes the working copy and
   * live content is untouched. `false` publishes it.
   */
  draft?: boolean;
  /** Optimistic concurrency against the document (see `UpdateOptions.expectedUpdatedAt`). */
  expectedUpdatedAt?: string | Date;
}

/* ---------------------------- Scheduling (#16) ---------------------------- */

/** A document's pending schedule (ISO instants, `null` when not scheduled). */
export interface DocumentSchedule {
  /** When the working copy is published. */
  publishAt: string | null;
  /** When the document is unpublished. Published reads hide it from this instant on. */
  unpublishAt: string | null;
}

export interface ScheduleOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  id: string;
  /** Omitted: unchanged. `null`: cleared. Needs unpublished changes (a draft, or a published document's pending draft). */
  publishAt?: string | Date | null;
  /** Omitted: unchanged. `null`: cleared. Must be after `publishAt` when both are set. */
  unpublishAt?: string | Date | null;
}

export interface RunScheduledOptions {
  /** Process work due at or before this instant. Default: now. */
  now?: Date;
  /** Maximum documents per run (default 100). */
  limit?: number;
  context?: HookContext;
}

export interface ScheduledRunResult {
  published: { collection: string; id: string }[];
  unpublished: { collection: string; id: string }[];
  /** Publishes that failed (e.g. the draft does not pass validation). Their `publishAt` is cleared. */
  failed: { collection: string; id: string; action: "publish" | "unpublish"; message: string }[];
}

export interface PresignUploadOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  /** Original filename (sanitized into the storage key and stored as `filename`). */
  filename: string;
  /** Declared MIME type (e.g. `"image/png"`). Re-verified against bytes on `completeUpload`. */
  mimeType: string;
  /** File size in bytes. */
  size: number;
  /** Optional existing document ID when replacing an upload document's file. */
  id?: string;
  /** Optimistic concurrency guard checked early when replacing an existing document. */
  expectedUpdatedAt?: string | Date;
  /** Presigned URL lifetime in seconds (default 900). */
  expiresIn?: number;
}

export interface PresignUploadOutput {
  /** Storage key that the presigned request writes to. */
  key: string;
  /** Signed upload token to submit to `completeUpload` / `POST /{api}/{collection}/_complete`. */
  token: string;
  /** Direct-to-storage upload target (`PUT` URL, required headers, expiration). */
  upload: {
    url: string;
    method: "PUT" | "POST";
    headers: Record<string, string>;
    expiresAt: string;
  };
  /** Final public URL of the uploaded object. */
  url: string;
}

export interface CompleteUploadOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  /** Signed upload token returned by `presignUpload` / `POST /{api}/{collection}/_presign`. */
  token: string;
  /** Optional explicit storage key check (must match the signed token when provided). */
  key?: string;
  /** Document field values (validated identically to `create` / `update`). */
  data: InferCreateInput<Coll<Cfg, S>> | InferUpdateInput<Coll<Cfg, S>>;
  /** Document ID when replacing an existing upload document's file (must match the signed token). */
  id?: string;
  /** Optimistic concurrency guard when replacing an existing document. */
  expectedUpdatedAt?: string | Date;
}

/** Minimal BetterAuth surface used by Xenon (avoids leaking BetterAuth's huge generic types). */
export interface XenonAuth {
  handler(request: Request): Promise<Response>;
  /** BetterAuth context (internal adapter etc.). */
  $context: Promise<{ internalAdapter: { countTotalUsers(): Promise<number> } }>;
  api: {
    getSession(args: { headers: Headers }): Promise<{
      user: { id: string; email: string; name?: string | null; role?: string | null };
      session: { id: string; expiresAt: Date };
    } | null>;
  } & Record<string, unknown>;
}

export interface XenonInstance<Cfg extends XenonConfig = XenonConfig> {
  readonly config: Cfg;
  /** Idempotent. Runs the adapter's `init()`; auth is set up lazily on first `getAuth()`. */
  init(): Promise<void>;

  find<
    S extends Slug<Cfg>,
    const Sel extends SelectArg<Cfg, S> | undefined = undefined,
    const Pop extends PopulateArg<Cfg, S> | undefined = undefined,
  >(
    options: FindOptions<Cfg, S, Sel, Pop>,
  ): Promise<PaginatedResult<QueryDocOf<Cfg, S, Sel, Pop>>>;
  findById<
    S extends Slug<Cfg>,
    const Sel extends SelectArg<Cfg, S> | undefined = undefined,
    const Pop extends PopulateArg<Cfg, S> | undefined = undefined,
  >(
    options: FindByIdOptions<Cfg, S, Sel, Pop>,
  ): Promise<QueryDocOf<Cfg, S, Sel, Pop> | null>;
  findBySlug<
    S extends Slug<Cfg>,
    const Sel extends SelectArg<Cfg, S> | undefined = undefined,
    const Pop extends PopulateArg<Cfg, S> | undefined = undefined,
  >(
    options: FindBySlugOptions<Cfg, S, Sel, Pop>,
  ): Promise<QueryDocOf<Cfg, S, Sel, Pop> | null>;
  create<S extends Slug<Cfg>>(options: CreateOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
  /** Throws `XenonError("NOT_FOUND")`. */
  update<S extends Slug<Cfg>>(options: UpdateOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
  unpublish<S extends Slug<Cfg>>(options: ByIdOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
  /**
   * Returns the deleted document. Collections with `trash` move it to the trash instead (it stops
   * appearing in reads and can be restored). Throws `XenonError("NOT_FOUND")`.
   */
  delete<S extends Slug<Cfg>>(options: ByIdOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
  /** Brings a document back from the trash (`update` access). Returns its working copy. */
  restore<S extends Slug<Cfg>>(options: ByIdOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
  /** Deletes a document for good, from the trash or not (`delete` access), with its file and versions. */
  purge<S extends Slug<Cfg>>(options: ByIdOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
  /**
   * Copies a document into a new one (a draft when the collection uses drafts) through `create`.
   * Values of `unique` fields are left out, and the slug is generated afresh. Not for upload collections.
   */
  duplicate<S extends Slug<Cfg>>(options: DuplicateOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;

  /** A document's versions, newest first (collections with `versions`). Needs draft read access. */
  findVersions<S extends Slug<Cfg>>(options: FindVersionsOptions<Cfg, S>): Promise<PaginatedResult<DocumentVersion<DocOf<Cfg, S>>>>;
  /** One version by its id, or `null`. */
  findVersionById<S extends Slug<Cfg>>(options: ByIdOptions<Cfg, S>): Promise<DocumentVersion<DocOf<Cfg, S>> | null>;
  /** Restore a version (by version id) onto its document; runs as an `update` (hooks, access, onChange). */
  restoreVersion<S extends Slug<Cfg>>(options: RestoreVersionOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;

  /** A document's pending schedule (draft-enabled collections). */
  getSchedule<S extends Slug<Cfg>>(options: ByIdOptions<Cfg, S>): Promise<DocumentSchedule>;
  /** Schedule a publish and/or unpublish. Needs `update` access and an adapter with `findDue`. */
  schedule<S extends Slug<Cfg>>(options: ScheduleOptions<Cfg, S>): Promise<DocumentSchedule>;
  /**
   * Runs due scheduled publishes and unpublishes through `update` / `unpublish` (hooks, versions,
   * `onChange`). Trusted (no access checks). Call it from a cron job, or use `{api}/_cron/publish`.
   */
  runScheduled(options?: RunScheduledOptions): Promise<ScheduledRunResult>;
  /** `true` when the database adapter supports scheduled publishing (`findDue`). */
  readonly supportsScheduling: boolean;

  /** Collection definition by slug, or `undefined`. */
  getCollection(slug: string): AnyCollection | undefined;

  /** Read a singleton global document (`null` when never saved or unpublished and `draft` is false). */
  getGlobal<
    S extends GSlug<Cfg>,
    const Sel extends SelectGlobalArg<Cfg, S> | undefined = undefined,
    const Pop extends PopulateGlobalArg<Cfg, S> | undefined = undefined,
  >(
    options: GetGlobalOptions<Cfg, S, Sel, Pop>,
  ): Promise<QueryGlobalDocOf<Cfg, S, Sel, Pop> | null>;
  /** Create (first write) or update a singleton global document. */
  updateGlobal<S extends GSlug<Cfg>>(options: UpdateGlobalOptions<Cfg, S>): Promise<GlobalDocOf<Cfg, S>>;
  /** Unpublish a singleton global document (requires drafts enabled). */
  unpublishGlobal<S extends GSlug<Cfg>>(options: UnpublishGlobalOptions<Cfg, S>): Promise<GlobalDocOf<Cfg, S>>;

  /** BetterAuth instance; `null` if the config has no `db`. */
  getAuth(): Promise<XenonAuth | null>;
  /** Resolve the acting user from a session cookie or `Authorization: Bearer <apiKey>`. */
  getUser(headers: Headers): Promise<XenonUser | null>;
  /** Handle a BetterAuth request (`{api.path}/auth/*`). 404 when auth is not configured. */
  handleAuthRequest(request: Request): Promise<Response>;
  /** Stream an uploaded file (`{api.path}/_files/{key}`); `null` if missing or unsupported. */
  readFile(key: string): Promise<StoredFile | null>;
  /** `true` when the configured storage adapter supports direct presigned uploads (`createPresignedUpload` + `head` + `readRange`). */
  readonly supportsPresignedUploads: boolean;
  /** Mint a presigned direct-to-storage upload URL and signed completion token for an upload collection. */
  presignUpload<S extends Slug<Cfg>>(options: PresignUploadOptions<Cfg, S>): Promise<PresignUploadOutput>;
  /**
   * Verify a presigned upload via `HEAD` + Range `GET` (size, magic bytes, active-content block, image dimensions)
   * and create (or replace, when `id` is bound) the document record. Deletes the object immediately on any failure.
   */
  completeUpload<S extends Slug<Cfg>>(options: CompleteUploadOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
}
