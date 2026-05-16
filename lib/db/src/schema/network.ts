import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { candidatesTable } from "./candidates";
import { employersTable } from "./employers";
import { institutionsTable } from "./institutions";
import { usersTable } from "./auth";

/**
 * Mentorship requests between two candidates that share an institution
 * affiliation. The mentor must have opted in (candidates.alumni_mentor_optin).
 * One pending/accepted request per (requester, mentor) pair.
 */
export const mentorshipRequestsTable = pgTable(
  "mentorship_requests",
  {
    id: serial("id").primaryKey(),
    requesterCandidateId: integer("requester_candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    mentorCandidateId: integer("mentor_candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id, { onDelete: "cascade" }),
    message: text("message").notNull().default(""),
    // pending | accepted | declined
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => ({
    pairUnique: uniqueIndex("mentorship_pair_unique").on(
      t.requesterCandidateId,
      t.mentorCandidateId,
    ),
    mentorIdx: index("mentorship_mentor_idx").on(t.mentorCandidateId),
    requesterIdx: index("mentorship_requester_idx").on(
      t.requesterCandidateId,
    ),
  }),
);

export type MentorshipRequest = typeof mentorshipRequestsTable.$inferSelect;
export type InsertMentorshipRequest =
  typeof mentorshipRequestsTable.$inferInsert;

/**
 * Verified-hire reviews of an employer, scoped to the candidate's
 * institution. One review per (employer, candidate). All reviews start
 * pending until an admin approves them.
 */
export const employerReviewsTable = pgTable(
  "employer_reviews",
  {
    id: serial("id").primaryKey(),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    body: text("body").notNull().default(""),
    // pending | approved | rejected
    status: text("status").notNull().default("pending"),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatedBy: integer("moderated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    moderationNote: text("moderation_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairUnique: uniqueIndex("employer_review_unique").on(
      t.employerId,
      t.candidateId,
    ),
    employerStatusIdx: index("employer_review_employer_status_idx").on(
      t.employerId,
      t.status,
    ),
    statusIdx: index("employer_review_status_idx").on(t.status),
  }),
);

export type EmployerReview = typeof employerReviewsTable.$inferSelect;
export type InsertEmployerReview = typeof employerReviewsTable.$inferInsert;

/**
 * Moderated student-success spotlights surfaced on the public marketplace
 * homepage. Created by candidates after a hire, approved by admins.
 */
export const placementStoriesTable = pgTable(
  "placement_stories",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    institutionId: integer("institution_id").references(
      () => institutionsTable.id,
      { onDelete: "set null" },
    ),
    quote: text("quote").notNull(),
    photoUrl: text("photo_url"),
    // pending | approved | rejected
    status: text("status").notNull().default("pending"),
    sortOrder: integer("sort_order").notNull().default(0),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatedBy: integer("moderated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    moderationNote: text("moderation_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("placement_story_status_idx").on(t.status, t.sortOrder),
  }),
);

export type PlacementStory = typeof placementStoriesTable.$inferSelect;
export type InsertPlacementStory = typeof placementStoriesTable.$inferInsert;
