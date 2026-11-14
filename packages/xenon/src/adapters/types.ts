/**
 * Adapter contracts — DRAFT for Phase 2. Shapes may still change before Phase 2 starts;
 * coordinate with the coordinator before implementing against them.
 */
import type { DocumentStatus } from "../core/types";

/** A raw row of the polymorphic `xenon_documents` table. */
export interface DocumentRecord {
  id: string;
  collection: string;
  slug: string | null;
  status: DocumentStatus;
  /** Published data (what public reads see). */
  data: Record<string, unknown>;
  /** Unpublished working copy, or `null` when there are no pending changes. */
  draftData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export type WhereOperator = {
  equals?: unknown;
  not_equals?: unknown;
  in?: readonly unknown[];
  not_in?: readonly unknown[];
  contains?: string;
  gt?: number | string;
  gte?: number | string;
  lt?: number | string;
  lte?: number | string;
  exists?: boolean;
};

/** Field path → operator. Top-level keys may also be system keys (`slug`, `status`, ...). */
export type Where = { [field: string]: WhereOperator | Where[] | undefined; and?: Where[]; or?: Where[] };

export interface FindArgs {
  collection: string;
  where?: Where;
  /** Field name; prefix with `-` for descending. Default `-createdAt`. */
  sort?: string;
  limit?: number;
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

export interface DatabaseAdapter {
  readonly name: string;
  /** Idempotent: ensure tables/indexes exist. */
  init?(): Promise<void>;
  find(args: FindArgs): Promise<PaginatedResult<DocumentRecord>>;
  findById(collection: string, id: string): Promise<DocumentRecord | null>;
  create(input: CreateRecordInput): Promise<DocumentRecord>;
  update(collection: string, id: string, input: UpdateRecordInput): Promise<DocumentRecord | null>;
  delete(collection: string, id: string): Promise<boolean>;
}

export interface UploadFileInput {
  /** Storage key, e.g. `media/2026/11/photo.jpg`. */
  key: string;
  body: Uint8Array | ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
}

export interface StorageAdapter {
  readonly name: string;
  upload(file: UploadFileInput): Promise<{ key: string; url: string }>;
  delete(key: string): Promise<void>;
  /** Public URL for a stored key. */
  getUrl(key: string): string;
}
