/**
 * Local API surface (CONTRACTS §3). The REST handler and the admin UI build on this interface only.
 */
import type { PaginatedResult, StoredFile, Where } from "../adapters/types";
import type {
  AnyCollection,
  CollectionBySlug,
  CollectionSlug,
  InferCollectionType,
  InferCreateInput,
  InferDraftInput,
  InferUpdateInput,
  XenonConfig,
  XenonUser,
} from "../core/types";

export type XenonOperation = "create" | "update" | "delete";

export interface XenonChangeEvent {
  collection: string;
  id: string;
  op: XenonOperation | "unpublish";
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
}

type Slug<Cfg> = CollectionSlug<Cfg> & string;
// Narrow via `infer … extends` (an `& AnyCollection` intersection would widen `fields` to an index signature).
type Coll<Cfg, S extends Slug<Cfg>> = CollectionBySlug<Cfg, S> extends infer C extends AnyCollection ? C : never;
export type DocOf<Cfg, S extends Slug<Cfg>> = InferCollectionType<Coll<Cfg, S>>;

export interface FindOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  where?: Where;
  sort?: string;
  limit?: number;
  page?: number;
  /** Read working copies (`draftData ?? data`) of all documents. Default `false`. */
  draft?: boolean;
}

export interface FindByIdOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  id: string;
  draft?: boolean;
}

export interface FindBySlugOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  slug: string;
  draft?: boolean;
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
}

export interface UpdateOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  id: string;
  data: InferUpdateInput<Coll<Cfg, S>> | InferDraftInput<Coll<Cfg, S>>;
  draft?: boolean;
  /** Replace the stored file (upload collections). */
  file?: UploadFile;
  /**
   * Optimistic concurrency: the `updatedAt` of the version the caller edited. When the document has
   * been saved since, the update is refused with a `CONFLICT` error instead of overwriting.
   */
  expectedUpdatedAt?: string | Date;
}

export interface ByIdOptions<Cfg, S extends Slug<Cfg>> extends CallContext {
  collection: S;
  id: string;
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

  find<S extends Slug<Cfg>>(options: FindOptions<Cfg, S>): Promise<PaginatedResult<DocOf<Cfg, S>>>;
  findById<S extends Slug<Cfg>>(options: FindByIdOptions<Cfg, S>): Promise<DocOf<Cfg, S> | null>;
  findBySlug<S extends Slug<Cfg>>(options: FindBySlugOptions<Cfg, S>): Promise<DocOf<Cfg, S> | null>;
  create<S extends Slug<Cfg>>(options: CreateOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
  /** Throws `XenonError("NOT_FOUND")`. */
  update<S extends Slug<Cfg>>(options: UpdateOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
  unpublish<S extends Slug<Cfg>>(options: ByIdOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;
  /** Returns the deleted document. Throws `XenonError("NOT_FOUND")`. */
  delete<S extends Slug<Cfg>>(options: ByIdOptions<Cfg, S>): Promise<DocOf<Cfg, S>>;

  /** Collection definition by slug, or `undefined`. */
  getCollection(slug: string): AnyCollection | undefined;

  /** BetterAuth instance; `null` if the config has no `db`. */
  getAuth(): Promise<XenonAuth | null>;
  /** Resolve the acting user from a session cookie or `Authorization: Bearer <apiKey>`. */
  getUser(headers: Headers): Promise<XenonUser | null>;
  /** Handle a BetterAuth request (`{api.path}/auth/*`). 404 when auth is not configured. */
  handleAuthRequest(request: Request): Promise<Response>;
  /** Stream an uploaded file (`{api.path}/_files/{key}`); `null` if missing or unsupported. */
  readFile(key: string): Promise<StoredFile | null>;
}
