import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { employersTable } from "./employers";
import { candidatesTable } from "./candidates";
import { jobsTable } from "./jobs";

/**
 * Per-employer daily candidate deck — the swipe-back equivalent of the
 * candidate "For You" feed. One row per (employer, deckDate). The
 * ordered list of candidate ids is denormalized into JSONB so we
 * preserve the original ranking even if a candidate's score later
 * shifts.  Generated lazily on first GET /me/daily-deck of the day.
 */
export const employerDailyDecksTable = pgTable(
  "employer_daily_decks",
  {
    id: serial("id").primaryKey(),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    /** ISO date string "YYYY-MM-DD" — the deck's calendar day in the
     * employer's local timezone (UTC for v1). */
    deckDate: text("deck_date").notNull(),
    candidateIds: jsonb("candidate_ids").notNull().$type<number[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    employerDateUnique: uniqueIndex("employer_daily_deck_unique").on(
      t.employerId,
      t.deckDate,
    ),
  }),
);

export type EmployerDailyDeck = typeof employerDailyDecksTable.$inferSelect;
export type InsertEmployerDailyDeck =
  typeof employerDailyDecksTable.$inferInsert;

/**
 * Per-employer "swiped left" log. A row here permanently excludes the
 * candidate from future decks for the employer (`jobId` null) or for a
 * specific job (`jobId` set).  v1 batches by employer only, so the
 * column is kept nullable for forward compatibility with per-job
 * swiping.
 */
export const employerDismissedCandidatesTable = pgTable(
  "employer_dismissed_candidates",
  {
    id: serial("id").primaryKey(),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id").references(() => jobsTable.id, {
      onDelete: "cascade",
    }),
    /** Optional free-text reason captured from the swipe gesture. */
    reason: text("reason"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Postgres treats NULLs as distinct in a unique index, so a
    // straight unique on (employerId, candidateId, jobId) would still
    // allow duplicate (employerId, candidateId, NULL) rows — defeating
    // the idempotency guarantee callers depend on. Split into two
    // partial unique indexes covering the NULL and non-NULL cases.
    perJobUnique: uniqueIndex("employer_dismissed_per_job_unique")
      .on(t.employerId, t.candidateId, t.jobId)
      .where(sql`${t.jobId} IS NOT NULL`),
    perEmployerUnique: uniqueIndex("employer_dismissed_per_employer_unique")
      .on(t.employerId, t.candidateId)
      .where(sql`${t.jobId} IS NULL`),
    employerIdx: index("employer_dismissed_employer_idx").on(t.employerId),
  }),
);

export type EmployerDismissedCandidate =
  typeof employerDismissedCandidatesTable.$inferSelect;
export type InsertEmployerDismissedCandidate =
  typeof employerDismissedCandidatesTable.$inferInsert;
