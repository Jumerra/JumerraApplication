import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const institutionsTable = pgTable(
  "institutions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    location: text("location").notNull(),
    logoUrl: text("logo_url").notNull(),
    websiteUrl: text("website_url").notNull(),
    description: text("description").notNull(),
    /**
     * Admin user (`role='admin' AND org_role='account_manager'`) who
     * "owns" this institution in the platform-admin CRM sense. See
     * employers.account_manager_id for the full rationale. Nullable;
     * ON DELETE SET NULL.
     */
    accountManagerId: integer("account_manager_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    institutionAccountManagerIdx: index(
      "institution_account_manager_idx",
    ).on(t.accountManagerId),
  }),
);

export type Institution = typeof institutionsTable.$inferSelect;
export type InsertInstitution = typeof institutionsTable.$inferInsert;
