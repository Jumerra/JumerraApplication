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
    /**
     * Fast-Track Pledge (task #76). When true, every job this employer
     * posts displays a "Fast-Track: 48hr response" badge and candidates
     * can filter the job board to show only these roles. The nightly
     * SLA sweep auto-revokes (`fastTrackEnabled = false`,
     * `fastTrackRevokedUntil = +30d`) if the employer breaks the SLA
     * twice within a 30-day rolling window.
     */
    fastTrackEnabled: boolean("fast_track_enabled").notNull().default(false),
    fastTrackEnabledAt: timestamp("fast_track_enabled_at", {
      withTimezone: true,
    }),
    /**
     * Set by the sweep on auto-revoke. While `now() < revokedUntil` the
     * employer cannot re-enable the pledge from the dashboard. Null
     * means "no active revocation".
     */
    fastTrackRevokedUntil: timestamp("fast_track_revoked_until", {
      withTimezone: true,
    }),
    /**
     * IANA timezone name (e.g. "Africa/Accra", "Europe/London") used to
     * compute the local calendar day for the employer's daily candidate
     * deck (task #79). The deck rolls over at local midnight in this
     * zone so a recruiter in Accra and one in Tokyo both get a fresh
     * deck at their own start-of-day. Defaults to UTC for legacy rows.
     */
    dailyDeckTimezone: text("daily_deck_timezone").notNull().default("UTC"),
    /**
     * Hour-of-day (0-23, local to `dailyDeckTimezone`) at which the
     * daily deck rolls over. e.g. 8 means "show me a fresh deck at
     * 8am local". Lets recruiters get a new batch aligned with their
     * own start-of-day instead of strict local midnight. Defaults to
     * 0 (= midnight rollover).
     */
    dailyDeckRefreshHour: integer("daily_deck_refresh_hour").notNull().default(0),
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
