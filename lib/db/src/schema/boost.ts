import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Singleton row (id=1) holding admin-controlled "Profile Boost" config.
 *
 * - `isActive` is the global on/off toggle. When false, candidates do
 *   not see the boost CTA at all and the checkout endpoint refuses.
 * - `priceCents` and `currency` are the price snapshot used at checkout
 *   time (admin can change at any moment; the snapshot is captured into
 *   `boostPaymentsTable` for each transaction).
 * - `durationDays` is how long a successful boost lasts.
 */
export const boostSettingsTable = pgTable("boost_settings", {
  id: serial("id").primaryKey(),
  isActive: boolean("is_active").notNull().default(false),
  priceCents: integer("price_cents").notNull().default(2900),
  currency: text("currency").notNull().default("usd"),
  durationDays: integer("duration_days").notNull().default(7),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: integer("updated_by"),
});

export type BoostSettings = typeof boostSettingsTable.$inferSelect;
export type InsertBoostSettings = typeof boostSettingsTable.$inferInsert;

/**
 * One row per Stripe Checkout Session attempted by a candidate. We
 * snapshot the price + duration at the time the session is created so
 * the candidate is always charged the amount they were quoted, even if
 * the admin updates the price mid-flight.
 *
 * `status` lifecycle: 'pending' → 'paid' (after verify) | 'failed' |
 * 'expired' (the candidate never completed checkout).
 */
export const boostPaymentsTable = pgTable("boost_payments", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  durationDays: integer("duration_days").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  boostExpiresAt: timestamp("boost_expires_at", { withTimezone: true }),
});

export type BoostPayment = typeof boostPaymentsTable.$inferSelect;
export type InsertBoostPayment = typeof boostPaymentsTable.$inferInsert;
