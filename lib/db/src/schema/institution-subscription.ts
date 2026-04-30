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
 * Singleton row (id=1) holding admin-controlled "Premium Yearly
 * Subscription for Institutions" config.
 *
 * - `isActive` is the global on/off toggle. When false, institutions do
 *   not see the subscription CTA at all, the checkout endpoint refuses,
 *   and the placements view is NOT gated (i.e. everyone gets it free).
 * - `priceCents` and `currency` are the price snapshot used at checkout
 *   time (admin can change at any moment; the snapshot is captured into
 *   `institutionSubscriptionsTable` for each transaction).
 * - `trialDays` is the free-trial length applied to every new
 *   subscription (0 = no trial). The trial is configured via
 *   Stripe's `subscription_data.trial_period_days` so Stripe enforces
 *   billing automatically.
 */
export const institutionSubscriptionSettingsTable = pgTable(
  "institution_subscription_settings",
  {
    id: serial("id").primaryKey(),
    isActive: boolean("is_active").notNull().default(false),
    priceCents: integer("price_cents").notNull().default(49900),
    currency: text("currency").notNull().default("usd"),
    trialDays: integer("trial_days").notNull().default(14),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: integer("updated_by"),
  },
);

export type InstitutionSubscriptionSettings =
  typeof institutionSubscriptionSettingsTable.$inferSelect;
export type InsertInstitutionSubscriptionSettings =
  typeof institutionSubscriptionSettingsTable.$inferInsert;

/**
 * One row per Stripe Checkout Session attempted by an institution. We
 * snapshot the price + trial length at the time the session is created
 * so the institution is always charged the amount they were quoted,
 * even if the admin updates the price mid-flight.
 *
 * `status` lifecycle for the row that represents a successful
 * subscription:
 *   'pending'  → checkout created, waiting on Stripe success
 *   'trialing' → Stripe subscription exists in trial period
 *   'active'   → Stripe subscription is past trial and paid
 *   'expired'  → past `currentPeriodEnd` with no renewal observed
 *   'canceled' → admin or institution canceled
 *   'failed'   → checkout closed without payment
 *
 * `currentPeriodEnd` is the authoritative entitlement-expiry timestamp
 * the API uses to decide whether placements are unlocked. We trust
 * Stripe to be the source of truth for renewals — see the verify
 * endpoint and any future webhook handler for refresh logic.
 */
export const institutionSubscriptionsTable = pgTable(
  "institution_subscriptions",
  {
    id: serial("id").primaryKey(),
    institutionId: integer("institution_id").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id")
      .notNull()
      .unique(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull().default("pending"),
    priceCentsSnapshot: integer("price_cents_snapshot").notNull(),
    currencySnapshot: text("currency_snapshot").notNull(),
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
    byInstitution: index("inst_sub_by_institution_idx").on(t.institutionId),
  }),
);

export type InstitutionSubscription =
  typeof institutionSubscriptionsTable.$inferSelect;
export type InsertInstitutionSubscription =
  typeof institutionSubscriptionsTable.$inferInsert;
