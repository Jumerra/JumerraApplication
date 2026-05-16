import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { candidatesTable } from "./candidates";
import { jobsTable } from "./jobs";

/**
 * Expo push tokens registered by mobile clients. One row per (token);
 * a single user may have multiple tokens (e.g. iPhone + iPad). Tokens
 * are revoked by deleting the row when the device asks to opt out or
 * the Expo push service reports `DeviceNotRegistered`.
 */
export const expoPushTokensTable = pgTable(
  "expo_push_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull().default("unknown"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    expoPushTokenUnique: uniqueIndex("expo_push_token_unique").on(t.token),
    expoPushUserIdx: index("expo_push_user_idx").on(t.userId),
  }),
);

export type ExpoPushToken = typeof expoPushTokensTable.$inferSelect;

/**
 * Per-user notification category preferences. Defaults are all-true
 * (set in the dispatcher when no row exists, so we never have to
 * backfill). One row per user.
 */
export const notificationPrefsTable = pgTable(
  "notification_prefs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    strongMatch: boolean("strong_match").notNull().default(true),
    applicationStatus: boolean("application_status").notNull().default(true),
    interviewReminder: boolean("interview_reminder").notNull().default(true),
    profileViewed: boolean("profile_viewed").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    notificationPrefsUserUnique: uniqueIndex("notification_prefs_user_unique").on(
      t.userId,
    ),
  }),
);

export type NotificationPrefs = typeof notificationPrefsTable.$inferSelect;

/**
 * Jobs the candidate has swiped left on in the For You feed. They are
 * never re-surfaced. Cascade deletes if either side is removed.
 */
export const candidateDismissedJobsTable = pgTable(
  "candidate_dismissed_jobs",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    candidateDismissedJobUnique: uniqueIndex("candidate_dismissed_job_unique").on(
      t.candidateId,
      t.jobId,
    ),
  }),
);

export type CandidateDismissedJob =
  typeof candidateDismissedJobsTable.$inferSelect;
