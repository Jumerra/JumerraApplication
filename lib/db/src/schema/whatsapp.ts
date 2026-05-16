import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Delivery log for outbound WhatsApp messages. One row per send
 * attempt, written by the WhatsApp library stub (whether or not a
 * provider is configured). Admins read this via
 * `GET /admin/whatsapp-logs` to debug delivery and audit usage.
 *
 * Status values:
 *   - "queued":  attempt began (no provider call yet)
 *   - "sent":    provider accepted the message
 *   - "failed":  provider rejected the message
 *   - "skipped": no provider configured (stub path)
 *
 * `error` carries a human-readable reason for failed/skipped rows.
 * `providerMessageId` is set for "sent" rows when the provider returns
 * a tracking id (Twilio SID / Meta WA message id).
 */
export const whatsappMessageLogTable = pgTable(
  "whatsapp_message_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    /** E.164 number the message was addressed to. */
    toNumber: text("to_number").notNull(),
    /** Category label — mirrors NotificationCategory plus "otp". */
    category: text("category").notNull(),
    /** Pre-approved template key used to render the body. */
    templateKey: text("template_key").notNull(),
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    waLogUserIdx: index("wa_log_user_idx").on(t.userId),
    waLogCreatedIdx: index("wa_log_created_idx").on(t.createdAt),
  }),
);

export type WhatsappMessageLog = typeof whatsappMessageLogTable.$inferSelect;
export type InsertWhatsappMessageLog =
  typeof whatsappMessageLogTable.$inferInsert;
