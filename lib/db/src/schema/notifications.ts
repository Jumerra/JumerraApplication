import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * In-app notifications. Newest-first per user; `readAt` null = unread.
 * `link` is an optional in-app route to navigate to when the user
 * clicks the notification.
 */
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // e.g. "institution_verified", "institution_unverified"
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    notifUserCreatedIdx: index("notif_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
    notifUserUnreadIdx: index("notif_user_unread_idx").on(t.userId, t.readAt),
  }),
);

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
