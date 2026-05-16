import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Singleton row (id=1) holding admin-controlled "AI CV Builder" config.
 * Mirrors the boost_settings layout: a global on/off plus a price the
 * candidate is charged once to unlock the feature for life.
 */
export const cvSettingsTable = pgTable("cv_settings", {
  id: serial("id").primaryKey(),
  isActive: boolean("is_active").notNull().default(false),
  priceCents: integer("price_cents").notNull().default(1900),
  currency: text("currency").notNull().default("usd"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: integer("updated_by"),
});

export type CvSettings = typeof cvSettingsTable.$inferSelect;
export type InsertCvSettings = typeof cvSettingsTable.$inferInsert;

/**
 * One-time AI CV Builder unlock purchase. Same shape as
 * boost_payments; we keep them in separate tables so each premium
 * feature has an isolated, auditable history.
 */
export const cvPaymentsTable = pgTable("cv_payments", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  provider: text("provider").notNull().default("stripe"),
  paystackReference: text("paystack_reference"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export type CvPayment = typeof cvPaymentsTable.$inferSelect;
export type InsertCvPayment = typeof cvPaymentsTable.$inferInsert;
