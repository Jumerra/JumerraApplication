import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Editable site content for the public marketing pages. Each row is a
 * single field (text snippet or image URL) keyed by a stable string
 * (e.g. "home.hero.headline"). The home page reads this table at
 * render time and falls back to hard-coded defaults when a key is
 * missing, so the site never blanks out if the table is empty.
 */
export const siteContentTable = pgTable("site_content", {
  key: text("key").primaryKey(),
  type: text("type").notNull(), // 'text' | 'image'
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: integer("updated_by"),
});

export type SiteContent = typeof siteContentTable.$inferSelect;
export type InsertSiteContent = typeof siteContentTable.$inferInsert;
