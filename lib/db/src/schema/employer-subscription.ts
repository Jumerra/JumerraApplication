import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Singleton row (id=1) holding admin-controlled "Employer Job Posting
 * Premium" config.
 *
 * - `isActive` is the global on/off toggle. When false, employers see
 *   no paywall regardless of how many jobs they've posted, and the
 *   checkout endpoint refuses.
 * - `freeJobPostLimit` is the number of jobs an employer can post
 *   before they're prompted to subscribe (admin-configurable).
 * - `priceCents` and `currency` are the price snapshot used at
 *   checkout time (admin can change at any moment; the snapshot is
 *   captured into `employerSubscriptionsTable` for each transaction).
 * - `intervalDays` controls Stripe's recurring interval (30 = monthly
 *   billed, 365 = yearly billed). We map this to Stripe's
 *   `interval`/`interval_count` pair at checkout time.
 * - `trialDays` is the free-trial length applied to every new
 *   subscription (0 = no trial). Trials honor
 *   `payment_method_collection: 'if_required'` so employers don't
 *   need a card to start a trial.
 */
export const employerSubscriptionSettingsTable = pgTable(
  "employer_subscription_settings",
  {
    id: serial("id").primaryKey(),
    isActive: boolean("is_active").notNull().default(false),
    freeJobPostLimit: integer("free_job_post_limit").notNull().default(3),
    priceCents: integer("price_cents").notNull().default(4900),
    currency: text("currency").notNull().default("usd"),
    intervalDays: integer("interval_days").notNull().default(30),
    trialDays: integer("trial_days").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: integer("updated_by"),
  },
);

export type EmployerSubscriptionSettings =
  typeof employerSubscriptionSettingsTable.$inferSelect;
export type InsertEmployerSubscriptionSettings =
  typeof employerSubscriptionSettingsTable.$inferInsert;

/**
 * One row per Stripe Checkout Session attempted by an employer. Same
 * lifecycle and snapshotting rules as
 * `institution_subscriptions` — see that schema for the rationale.
 *
 * `status` lifecycle:
 *   'pending'  → checkout created, waiting on Stripe
 *   'trialing' → in trial period (no payment may have been collected)
 *   'active'   → past trial, paid subscription
 *   'expired'  → past `currentPeriodEnd` with no renewal observed
 *   'canceled' → admin or employer canceled
 *   'failed'   → checkout closed without payment
 */
export const employerSubscriptionsTable = pgTable(
  "employer_subscriptions",
  {
    id: serial("id").primaryKey(),
    employerId: integer("employer_id").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id")
      .notNull()
      .unique(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull().default("pending"),
    priceCentsSnapshot: integer("price_cents_snapshot").notNull(),
    currencySnapshot: text("currency_snapshot").notNull(),
    intervalDaysSnapshot: integer("interval_days_snapshot").notNull(),
    trialDaysSnapshot: integer("trial_days_snapshot").notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
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
    byEmployer: index("emp_sub_by_employer_idx").on(t.employerId),
  }),
);

export type EmployerSubscription =
  typeof employerSubscriptionsTable.$inferSelect;
export type InsertEmployerSubscription =
  typeof employerSubscriptionsTable.$inferInsert;
