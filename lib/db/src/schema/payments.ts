import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Unified payments ledger. Every checkout — across both providers and
 * across all five purchase flows (boost, cv, job-tier, institution-
 * subscription, employer-subscription) — writes a row here at create
 * time and updates it at finalize time. This is the single source of
 * truth for admin reporting and for the upcoming admin payments
 * console; the per-flow tables remain as the authoritative store for
 * flow-specific snapshot/unlock state.
 *
 * The (provider, external_ref) pair is unique because both providers
 * already guarantee unique session ids / references on their side.
 */
export const paymentsTable = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(), // 'stripe' | 'paystack'
    externalRef: text("external_ref").notNull(),
    /**
     * Which paywalled flow this payment was for. One of:
     * 'boost' | 'cv' | 'job_tier' | 'institution_subscription'
     * | 'employer_subscription'. Polymorphic by design — see
     * purposeId.
     */
    purposeType: text("purpose_type").notNull(),
    /**
     * Foreign key into the per-flow table (boost_payments.id,
     * cv_payments.id, etc). NOT enforced as a SQL FK because the
     * target table varies by purposeType.
     */
    purposeId: integer("purpose_id").notNull(),
    amountSubunits: integer("amount_subunits").notNull(),
    currency: text("currency").notNull(),
    /**
     * Mirror of the per-flow row's status so a single query against
     * this table can answer "what payments are pending / paid /
     * failed across the platform". Updated by the finalizers.
     */
    status: text("status").notNull().default("pending"),
    buyerUserId: integer("buyer_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (t) => ({
    providerRefUnique: uniqueIndex("payments_provider_ref_unique").on(
      t.provider,
      t.externalRef,
    ),
    byPurpose: index("payments_purpose_idx").on(t.purposeType, t.purposeId),
    byStatus: index("payments_status_idx").on(t.status),
  }),
);

export type Payment = typeof paymentsTable.$inferSelect;
export type InsertPayment = typeof paymentsTable.$inferInsert;
