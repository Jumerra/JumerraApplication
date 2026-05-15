import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const employersTable = pgTable(
  "employers",
  {
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
    /**
     * Admin user (`role='admin' AND org_role='account_manager'`) who
     * "owns" this employer in the platform-admin CRM sense. Used to
     * scope what each account manager sees and to attribute new sign-ups
     * back to whoever onboarded them. Nullable; super_admin can
     * (re)assign at any time. Null = unassigned. ON DELETE SET NULL so
     * removing a manager simply unassigns their accounts.
     */
    accountManagerId: integer("account_manager_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    /**
     * When set, this employer was migrated off the old recurring
     * subscription model and should see the "new pricing" banner in
     * the dashboard until they dismiss it (we never persist dismissal
     * — the banner just goes away if the column is cleared, e.g. for
     * accounts that signed up after the migration).
     */
    legacySubscriptionMigratedAt: timestamp(
      "legacy_subscription_migrated_at",
      { withTimezone: true },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    employerAccountManagerIdx: index("employer_account_manager_idx").on(
      t.accountManagerId,
    ),
  }),
);

export type Employer = typeof employersTable.$inferSelect;
export type InsertEmployer = typeof employersTable.$inferInsert;
