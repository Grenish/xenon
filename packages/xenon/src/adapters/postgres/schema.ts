import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * The single polymorphic content table. Collection schemas live in code and documents in JSONB,
 * so adding/removing fields never needs a destructive migration.
 */
export const xenonDocuments = pgTable(
  "xenon_documents",
  {
    id: text("id").primaryKey(),
    collection: text("collection").notNull(),
    slug: text("slug"),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    draftData: jsonb("draft_data").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    publishAt: timestamp("publish_at", { withTimezone: true, mode: "date" }),
    unpublishAt: timestamp("unpublish_at", { withTimezone: true, mode: "date" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("xenon_documents_collection_slug_idx")
      .on(t.collection, t.slug)
      .where(sql`${t.slug} is not null`),
    index("xenon_documents_collection_status_created_idx").on(t.collection, t.status, t.createdAt),
  ],
);

/** Snapshots of document data (#15). No foreign key: the Local API deletes a document's versions with it. */
export const xenonVersions = pgTable(
  "xenon_versions",
  {
    id: text("id").primaryKey(),
    collection: text("collection").notNull(),
    documentId: text("document_id").notNull(),
    kind: text("kind", { enum: ["publish", "draft", "restore"] }).notNull(),
    slug: text("slug"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    author: jsonb("author").$type<{ id: string; name: string | null; email: string | null } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("xenon_versions_document_idx").on(t.collection, t.documentId, t.createdAt)],
);

/** Idempotent DDL matching `xenonDocuments` (no drizzle-kit needed at runtime). */
export const DOCUMENTS_DDL = [
  `CREATE TABLE IF NOT EXISTS "xenon_documents" (
    "id" text PRIMARY KEY,
    "collection" text NOT NULL,
    "slug" text,
    "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published')),
    "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "draft_data" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "xenon_documents_collection_slug_idx"
    ON "xenon_documents" ("collection", "slug") WHERE "slug" IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS "xenon_documents_collection_status_created_idx"
    ON "xenon_documents" ("collection", "status", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "xenon_documents_data_gin_idx"
    ON "xenon_documents" USING gin ("data" jsonb_path_ops)`,
  // Scheduled publishing (#16): additive columns, so existing databases upgrade in place.
  `ALTER TABLE "xenon_documents" ADD COLUMN IF NOT EXISTS "publish_at" timestamptz`,
  `ALTER TABLE "xenon_documents" ADD COLUMN IF NOT EXISTS "unpublish_at" timestamptz`,
  `CREATE INDEX IF NOT EXISTS "xenon_documents_publish_at_idx"
    ON "xenon_documents" ("publish_at") WHERE "publish_at" IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS "xenon_documents_unpublish_at_idx"
    ON "xenon_documents" ("unpublish_at") WHERE "unpublish_at" IS NOT NULL`,
  // Trash (#18).
  `ALTER TABLE "xenon_documents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz`,
  `CREATE INDEX IF NOT EXISTS "xenon_documents_trash_idx"
    ON "xenon_documents" ("collection", "deleted_at") WHERE "deleted_at" IS NOT NULL`,
  // Version history (#15).
  `CREATE TABLE IF NOT EXISTS "xenon_versions" (
    "id" text PRIMARY KEY,
    "collection" text NOT NULL,
    "document_id" text NOT NULL,
    "kind" text NOT NULL CHECK ("kind" IN ('publish', 'draft', 'restore')),
    "slug" text,
    "data" jsonb NOT NULL,
    "author" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "xenon_versions_document_idx"
    ON "xenon_versions" ("collection", "document_id", "created_at")`,
];
