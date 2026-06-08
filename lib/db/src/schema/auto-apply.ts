import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Singleton row (id=1) holding admin-controlled "AI Auto-Apply" config.
 *
 * AI Auto-Apply is a premium opt-in service: when enabled, the platform
 * automatically submits a subscribed candidate's application to jobs that
 * score at or above `matchThreshold` against their profile.
 *
 * - `isActive` is the global on/off toggle. When false, candidates do not
 *   see the Auto-Apply CTA, the checkout endpoint refuses, and the engine
 *   submits nothing.
 * - `priceCents`, `currency` are the price snapshot used at checkout time
 *   (admin can change at any moment; the snapshot is captured into
 *   `autoApplySubscriptionsTable` for each transaction).
 * - `intervalDays` controls the recurring billing interval (30 = monthly).
 *   Mirrors `institution_subscription_settings`.
 * - `matchThreshold` is the minimum match score (0-100) a job must reach
 *   before Auto-Apply submits on the candidate's behalf.
 * - `dailyCap` is the maximum number of auto-submissions per candidate per
 *   rolling 24h window, so a burst of new postings can't fire dozens of
 *   applications at once.
 */
export const autoApplySettingsTable = pgTable("auto_apply_settings", {
  id: serial("id").primaryKey(),
  isActive: boolean("is_active").notNull().default(false),
  priceCents: integer("price_cents").notNull().default(150000),
  currency: text("currency").notNull().default("ngn"),
  intervalDays: integer("interval_days").notNull().default(30),
  matchThreshold: integer("match_threshold").notNull().default(75),
  dailyCap: integer("daily_cap").notNull().default(10),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: integer("updated_by"),
});

export type AutoApplySettings = typeof autoApplySettingsTable.$inferSelect;
export type InsertAutoApplySettings =
  typeof autoApplySettingsTable.$inferInsert;

/**
 * One row per checkout attempted by a candidate for the Auto-Apply
 * subscription. Snapshots the price + interval at create time so the
 * candidate is always charged the amount they were quoted.
 *
 * Paystack (the default rail) does not model recurring subscriptions
 * through our thin client, so a Paystack row is modelled as a one-shot
 * charge that covers one `intervalDays` period: on success the finalizer
 * flips status to `active` and stamps `currentPeriodEnd = now + interval`.
 * Renewal is a future explicit checkout. The Stripe branch (kept for
 * parity) uses the recurring subscription as usual.
 *
 * `status` lifecycle:
 *   'pending'  → checkout created, waiting on provider success
 *   'trialing' → Stripe subscription in trial period
 *   'active'   → paid and current
 *   'expired'  → past `currentPeriodEnd` with no renewal observed
 *   'canceled' → candidate or admin canceled
 *   'failed'   → checkout closed without payment
 */
export const autoApplySubscriptionsTable = pgTable(
  "auto_apply_subscriptions",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    // The stripe_checkout_session_id column carries a UNIQUE constraint
    // and is required on the row. For Paystack rows we reuse the
    // reference as the external id so the constraint still protects us
    // against duplicate inserts (same convention as boost / institution
    // subscription).
    stripeCheckoutSessionId: text("stripe_checkout_session_id")
      .notNull()
      .unique(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    provider: text("provider").notNull().default("stripe"),
    paystackReference: text("paystack_reference"),
    status: text("status").notNull().default("pending"),
    priceCentsSnapshot: integer("price_cents_snapshot").notNull(),
    currencySnapshot: text("currency_snapshot").notNull(),
    intervalDaysSnapshot: integer("interval_days_snapshot")
      .notNull()
      .default(30),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byCandidate: index("auto_apply_sub_by_candidate_idx").on(t.candidateId),
  }),
);

export type AutoApplySubscription =
  typeof autoApplySubscriptionsTable.$inferSelect;
export type InsertAutoApplySubscription =
  typeof autoApplySubscriptionsTable.$inferInsert;

/**
 * One row per job auto-submitted on a candidate's behalf. Backs two
 * things: the rolling-24h daily-cap check (count rows where created_at >
 * now - 24h) and the candidate-facing "recent auto-apply activity" list.
 *
 * The UNIQUE (candidate_id, job_id) index is a hard guard against the
 * engine ever auto-applying to the same job twice for the same candidate,
 * independent of the applications-table dedupe.
 */
export const autoApplyLogTable = pgTable(
  "auto_apply_log",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    jobId: integer("job_id").notNull(),
    // Nullable: set to the application row created by the engine. Kept
    // nullable so a log row survives if the application is later removed.
    applicationId: integer("application_id"),
    matchScore: integer("match_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    candidateJobUnique: uniqueIndex("auto_apply_log_candidate_job_unique").on(
      t.candidateId,
      t.jobId,
    ),
    byCandidateCreated: index("auto_apply_log_candidate_created_idx").on(
      t.candidateId,
      t.createdAt,
    ),
  }),
);

export type AutoApplyLog = typeof autoApplyLogTable.$inferSelect;
export type InsertAutoApplyLog = typeof autoApplyLogTable.$inferInsert;
