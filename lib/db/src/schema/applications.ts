import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const applicationsTable = pgTable(
  "applications",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    candidateId: integer("candidate_id").notNull(),
    status: text("status").notNull().default("applied"),
    matchScore: integer("match_score").notNull().default(0),
    coverNote: text("cover_note").notNull().default(""),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // Powers the admin applications list (default sort) and any
    // recent-activity feeds.
    appliedAtIdx: index("applications_applied_at_idx").on(t.appliedAt),
    // Powers the admin hires analytics query
    // (WHERE status='hired' ... GROUP BY date_trunc(updated_at)).
    statusUpdatedAtIdx: index("applications_status_updated_at_idx").on(
      t.status,
      t.updatedAt,
    ),
  }),
);

export type Application = typeof applicationsTable.$inferSelect;
export type InsertApplication = typeof applicationsTable.$inferInsert;
