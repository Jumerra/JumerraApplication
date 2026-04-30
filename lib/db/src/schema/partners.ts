import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Singleton row (id=1) holding the admin-controlled "Our Partners"
 * landing-page section config.
 *
 * - `isActive` is the global on/off toggle. When false, the partners
 *   section is not rendered on the public landing page at all.
 *
 * Mirrors the `boost_settings` singleton-row pattern.
 */
export const partnerSettingsTable = pgTable("partner_settings", {
  id: serial("id").primaryKey(),
  isActive: boolean("is_active").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: integer("updated_by"),
});

export type PartnerSettings = typeof partnerSettingsTable.$inferSelect;
export type InsertPartnerSettings = typeof partnerSettingsTable.$inferInsert;

/**
 * One row per partner shown in the landing-page marquee.
 *
 * `displayOrder` controls left-to-right ordering in the marquee; lower
 * numbers appear first. Two rows can share the same number — ties are
 * broken by `id` ascending so newly-added partners stay at the end.
 */
export const partnersTable = pgTable("partners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  logoUrl: text("logo_url").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Partner = typeof partnersTable.$inferSelect;
export type InsertPartner = typeof partnersTable.$inferInsert;
