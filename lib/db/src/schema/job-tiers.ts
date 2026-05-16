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
 * Singleton row (id=1) holding admin-controlled pricing for the per-job
 * Promoted / Sponsored tiers. The Free tier has no row here — it's
 * always available and always free. Sponsored implies Promoted ranking
 * plus active push to matching candidates.
 */
export const jobTierSettingsTable = pgTable("job_tier_settings", {
  id: serial("id").primaryKey(),
  /**
   * Promoted tier — pays for ranking only.
   */
  promotedActive: boolean("promoted_active").notNull().default(true),
  promotedPriceCents: integer("promoted_price_cents").notNull().default(2900),
  promotedCurrency: text("promoted_currency").notNull().default("usd"),
  promotedDurationDays: integer("promoted_duration_days")
    .notNull()
    .default(30),
  /**
   * Sponsored tier — Promoted ranking PLUS active candidate push.
   */
  sponsoredActive: boolean("sponsored_active").notNull().default(true),
  sponsoredPriceCents: integer("sponsored_price_cents")
    .notNull()
    .default(9900),
  sponsoredCurrency: text("sponsored_currency").notNull().default("usd"),
  sponsoredDurationDays: integer("sponsored_duration_days")
    .notNull()
    .default(30),
  /**
   * Maximum number of candidates a single Sponsored job is pushed to
   * over the life of the boost. Prevents a single big-spending
   * employer from notification-spamming the entire candidate pool.
   */
  sponsoredPushCap: integer("sponsored_push_cap").notNull().default(200),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: integer("updated_by"),
});

export type JobTierSettings = typeof jobTierSettingsTable.$inferSelect;
export type InsertJobTierSettings =
  typeof jobTierSettingsTable.$inferInsert;

/**
 * One row per Stripe Checkout Session attempted to upgrade a specific
 * job's tier. Mirrors the boost_payments shape so we get the same
 * idempotency semantics. `status` lifecycle: pending → paid | failed |
 * expired.
 */
export const jobTierPaymentsTable = pgTable(
  "job_tier_payments",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    employerId: integer("employer_id").notNull(),
    tier: text("tier").notNull(), // 'promoted' | 'sponsored'
    stripeSessionId: text("stripe_session_id").notNull().unique(),
    provider: text("provider").notNull().default("stripe"),
    paystackReference: text("paystack_reference"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    durationDays: integer("duration_days").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    tierExpiresAt: timestamp("tier_expires_at", { withTimezone: true }),
  },
  (t) => ({
    byJob: index("job_tier_payments_job_idx").on(t.jobId),
    byEmployer: index("job_tier_payments_employer_idx").on(t.employerId),
  }),
);

export type JobTierPayment = typeof jobTierPaymentsTable.$inferSelect;
export type InsertJobTierPayment =
  typeof jobTierPaymentsTable.$inferInsert;

/**
 * Records that we have pushed a Sponsored job to a particular candidate.
 * Used to enforce both the per-job push cap and a per-candidate daily
 * cap so we don't burn the channel.
 */
export const sponsoredJobPushesTable = pgTable(
  "sponsored_job_pushes",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    candidateId: integer("candidate_id").notNull(),
    pushedAt: timestamp("pushed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byJob: index("sponsored_pushes_job_idx").on(t.jobId),
    byCandidatePushedAt: index("sponsored_pushes_cand_at_idx").on(
      t.candidateId,
      t.pushedAt,
    ),
    // Race-safe per-job-per-candidate uniqueness. Lets the fan-out
    // INSERT use ON CONFLICT DO NOTHING so concurrent sponsored
    // verifications for the same job can never duplicate a push.
    uniqJobCandidate: uniqueIndex("sponsored_pushes_job_cand_uniq").on(
      t.jobId,
      t.candidateId,
    ),
  }),
);

export type SponsoredJobPush =
  typeof sponsoredJobPushesTable.$inferSelect;
export type InsertSponsoredJobPush =
  typeof sponsoredJobPushesTable.$inferInsert;
