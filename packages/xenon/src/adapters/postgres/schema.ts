import { sql } from "drizzle-orm";
import { customType, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

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
    searchVector: tsvector("search_vector"),
    draftSearchVector: tsvector("draft_search_vector"),
  },
  (t) => [
    uniqueIndex("xenon_documents_collection_slug_idx")
      .on(t.collection, t.slug)
      .where(sql`${t.slug} is not null`),
    index("xenon_documents_collection_status_created_idx").on(t.collection, t.status, t.createdAt),
  ],
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
  `ALTER TABLE "xenon_documents" ADD COLUMN IF NOT EXISTS "search_vector" tsvector`,
  `ALTER TABLE "xenon_documents" ADD COLUMN IF NOT EXISTS "draft_search_vector" tsvector`,
  `CREATE INDEX IF NOT EXISTS "xenon_documents_search_vector_gin_idx"
    ON "xenon_documents" USING gin ("search_vector")`,
  `CREATE INDEX IF NOT EXISTS "xenon_documents_draft_search_vector_gin_idx"
    ON "xenon_documents" USING gin ("draft_search_vector")`,
];
