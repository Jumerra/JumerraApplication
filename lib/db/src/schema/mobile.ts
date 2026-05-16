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
    weeklyDigest: boolean("weekly_digest").notNull().default(true),
    /**
     * WhatsApp per-category toggles. Default to FALSE (opt-in only) so
     * we never message a verified number without the candidate
     * explicitly enabling the channel. The dispatcher also requires
     * `users.whatsappVerifiedAt` to be non-null before sending — these
     * toggles are layered on top of that gate.
     */
    whatsappStrongMatch: boolean("whatsapp_strong_match")
      .notNull()
      .default(false),
    whatsappApplicationStatus: boolean("whatsapp_application_status")
      .notNull()
      .default(false),
    whatsappInterviewReminder: boolean("whatsapp_interview_reminder")
      .notNull()
      .default(false),
    whatsappWeeklyDigest: boolean("whatsapp_weekly_digest")
      .notNull()
      .default(false),
    /**
     * Per-candidate delivery slot for the weekly digest. The worker's
     * hourly gate fires only when the candidate's local time matches
     * (`digestDow`, `digestHour`). `digestTz` is an IANA id; when null
     * the worker falls back to `candidates.timezone` and then UTC.
     * Defaults are Mon (1) / 09:00 to preserve the prior behavior.
     */
    digestDow: integer("digest_dow").notNull().default(1),
    digestHour: integer("digest_hour").notNull().default(9),
    digestTz: text("digest_tz"),
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
