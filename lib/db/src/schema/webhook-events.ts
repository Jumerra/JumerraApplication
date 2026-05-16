import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Audit + idempotency log for every payment-provider webhook we
 * receive. Webhook deliveries are at-least-once — Stripe and Paystack
 * both retry on non-2xx responses and (less commonly) deliver the same
 * event twice on retry boundaries — so without this table a single
 * `charge.success` could unlock a feature twice or extend a boost
 * twice.
 *
 * The handler inserts a row keyed by `(provider, eventId)` BEFORE
 * mutating any payment row. The unique index causes any duplicate
 * delivery to throw `23505`, which the handler turns into a fast
 * `200 {duplicate:true}` so the provider stops retrying. The actual
 * unlock work runs inside the same transaction as the insert so a
 * mid-flight crash leaves no half-applied state.
 */
export const webhookEventsTable = pgTable(
  "webhook_events",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => ({
    byProviderEventId: uniqueIndex("webhook_events_provider_event_id_idx").on(
      t.provider,
      t.eventId,
    ),
  }),
);

export type WebhookEvent = typeof webhookEventsTable.$inferSelect;
export type InsertWebhookEvent = typeof webhookEventsTable.$inferInsert;
