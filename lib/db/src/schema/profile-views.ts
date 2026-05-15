import {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { candidatesTable } from "./candidates";
import { employersTable } from "./employers";
import { usersTable } from "./auth";

/**
 * Records each time an employer user opens a candidate profile.
 *
 * - `candidateId`: the candidate whose profile was viewed.
 * - `viewerUserId`: the employer user who opened it (NOT the employer
 *   organization id directly — that's `employerId` below). Cascades on
 *   user delete so we don't keep orphan rows.
 * - `employerId`: the employer organization the viewer belongs to,
 *   resolved server-side at write time. Used to show the candidate
 *   "Acme Corp viewed your profile" without an extra join at read time.
 * - `viewedAt`: when the view happened. We DON'T dedupe at write time;
 *   instead the read endpoint groups by (candidateId, viewerUserId)
 *   and shows the most recent view per viewer. Notification debouncing
 *   is handled separately at write time.
 */
export const profileViewsTable = pgTable(
  "profile_views",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    viewerUserId: integer("viewer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    profileViewsCandidateIdx: index("profile_views_candidate_idx").on(
      t.candidateId,
      t.viewedAt,
    ),
    profileViewsViewerIdx: index("profile_views_viewer_idx").on(
      t.viewerUserId,
      t.candidateId,
    ),
  }),
);

export type ProfileView = typeof profileViewsTable.$inferSelect;
export type InsertProfileView = typeof profileViewsTable.$inferInsert;

/**
 * Tracks the last time we sent a "your profile was viewed" notification
 * for a given (candidate, viewer-employer) pair, so we can debounce to
 * at most one notification per 24h window per employer per candidate.
 * Separate from `profile_views` because we want every individual view
 * recorded for the candidate's "Who viewed me" feed, but only one
 * notification per debounce window.
 */
export const profileViewNotificationsTable = pgTable(
  "profile_view_notifications",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    notifiedAt: timestamp("notified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    profileViewNotifUniq: uniqueIndex("profile_view_notif_uniq").on(
      t.candidateId,
      t.employerId,
    ),
  }),
);

export type ProfileViewNotification =
  typeof profileViewNotificationsTable.$inferSelect;
export type InsertProfileViewNotification =
  typeof profileViewNotificationsTable.$inferInsert;
