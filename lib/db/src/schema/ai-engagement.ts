import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Cache + audit log of AI engagement calls (cover-note draft, interview
 * prep, CV critique). Rows are looked up by (candidate_id, kind,
 * key_hash) so identical re-requests don't burn quota or cost. The same
 * table doubles as a per-day quota counter — `routes/ai.ts` counts
 * rows in the last 24h to enforce a per-candidate daily limit.
 */
export const aiRequestCacheTable = pgTable(
  "ai_request_cache",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    kind: text("kind").notNull(),
    keyHash: text("key_hash").notNull(),
    output: jsonb("output").notNull(),
    // Number of upstream AI invocations that have been attempted for
    // this cache row. Incremented on every retry (including failed
    // attempts that left the row in `_pending` state) so the daily
    // quota is computed from `SUM(attempts)`, not `COUNT(*)`. This
    // prevents callers from burning through Anthropic credits by
    // hammering the same key after a parse/model failure.
    attempts: integer("attempts").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqByKey: uniqueIndex("ai_request_cache_candidate_kind_key_uniq").on(
      t.candidateId,
      t.kind,
      t.keyHash,
    ),
    byCandidateCreated: index("ai_request_cache_candidate_created_idx").on(
      t.candidateId,
      t.createdAt,
    ),
  }),
);

export type AiRequestCache = typeof aiRequestCacheTable.$inferSelect;
export type InsertAiRequestCache = typeof aiRequestCacheTable.$inferInsert;
