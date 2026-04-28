import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const employersTable = pgTable("employers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull(),
  description: text("description").notNull(),
  industry: text("industry").notNull(),
  location: text("location").notNull(),
  logoUrl: text("logo_url").notNull(),
  coverUrl: text("cover_url").notNull(),
  websiteUrl: text("website_url").notNull(),
  size: text("size").notNull(),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Employer = typeof employersTable.$inferSelect;
export type InsertEmployer = typeof employersTable.$inferInsert;
