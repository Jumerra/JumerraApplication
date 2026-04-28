import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const institutionsTable = pgTable("institutions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  location: text("location").notNull(),
  logoUrl: text("logo_url").notNull(),
  websiteUrl: text("website_url").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Institution = typeof institutionsTable.$inferSelect;
export type InsertInstitution = typeof institutionsTable.$inferInsert;
