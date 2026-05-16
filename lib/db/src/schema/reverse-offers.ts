import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";

/**
 * Time-bound "open to offers" auction window. Candidates flip a toggle
 * to invite employers to bid for a bounded period (default 7 days, max
 * 30). The booleans `candidates.openToOffers` / `openToOffersSince`
 * remain the legacy long-running signal; this table tracks the explicit
 * auction windows for the reverse-offers flow.
 *
 * A candidate may have at most one ACTIVE window at a time (closesAt in
 * the future). Older windows stay as history (used for "X candidates
 * opened windows this week" analytics).
 */
export const candidateOpenWindowsTable = pgTable(
  "candidate_open_windows",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    candidateClosesIdx: index("candidate_open_windows_candidate_closes_idx").on(
      t.candidateId,
      t.closesAt,
    ),
  }),
);

export type CandidateOpenWindow =
  typeof candidateOpenWindowsTable.$inferSelect;
export type InsertCandidateOpenWindow =
  typeof candidateOpenWindowsTable.$inferInsert;

/**
 * Employer-initiated reverse offer against an open candidate. Status
 * lifecycle:
 *   pending → accepted | declined | countered | expired
 *
 * Counters create a NEW row (status=pending) with parentOfferId set to
 * the offer being countered. The original offer transitions to
 * `countered` and is no longer actionable. This is intentionally a
 * single-counter flow (out of scope: multi-round negotiation).
 *
 * Acceptance creates a corresponding `application` row with status
 * `offer` so the offer drops into the employer's existing pipeline.
 */
export const reverseOffersTable = pgTable(
  "reverse_offers",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    employerId: integer("employer_id").notNull(),
    /** Free-text role title the employer is bidding for. */
    jobTitle: text("job_title").notNull(),
    /** Salary range in whole units of `currency`. */
    salaryMin: integer("salary_min").notNull(),
    salaryMax: integer("salary_max").notNull(),
    currency: text("currency").notNull().default("USD"),
    /** Proposed start date (ISO date). Nullable for "flexible". */
    startDate: date("start_date"),
    note: text("note").notNull().default(""),
    /**
     * `pending` | `accepted` | `declined` | `countered` | `expired`.
     */
    status: text("status").notNull().default("pending"),
    /** Set when this offer is a counter to a previous offer. */
    parentOfferId: integer("parent_offer_id"),
    /**
     * Application row created on acceptance (status=offer). Lets the
     * employer side jump from the sent-offers list straight into the
     * Kanban card.
     */
    applicationId: integer("application_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    candidateStatusIdx: index("reverse_offers_candidate_status_idx").on(
      t.candidateId,
      t.status,
    ),
    employerCreatedIdx: index("reverse_offers_employer_created_idx").on(
      t.employerId,
      t.createdAt,
    ),
  }),
);

export type ReverseOffer = typeof reverseOffersTable.$inferSelect;
export type InsertReverseOffer = typeof reverseOffersTable.$inferInsert;
