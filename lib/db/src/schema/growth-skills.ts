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
import { applicationsTable } from "./applications";

/**
 * Per-candidate growth plan items derived from rejection patterns.
 * Task #75.
 *
 * `skill` is the lowercased skill name (matches how
 * `calculateMatchScore` normalises). A row is in one of four states:
 *   - "active"      : public — showing on the dashboard, not yet
 *                     completed.
 *   - "completed"   : public — the candidate marked it done (optionally
 *                     with a verificationUrl). Stays in the table so the
 *                     re-ping logic can find recently-completed skills.
 *   - "dismissed"   : internal — the candidate said "not for me"; the
 *                     analyser must not re-surface this skill and the
 *                     /me/growth-plan serializer filters it out.
 *   - "superseded"  : internal — was once active but fell out of the
 *                     current top-3. Kept (not deleted) so we have a
 *                     history of what we suggested, but filtered out of
 *                     the API response just like "dismissed".
 *
 * Unique (candidateId, skill) so the analyser can upsert safely; it
 * also keeps the table tight (no duplicate rows for the same skill).
 */
export const candidateGrowthSkillsTable = pgTable(
  "candidate_growth_skills",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    status: text("status").notNull().default("active"),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    // Wall-clock target the candidate aims to be ready by. The analyser
    // sets it to addedAt + the resource pack's estimated minutes
    // converted to days (rounded up, min 7 days).
    targetDate: timestamp("target_date", { withTimezone: true }),
    // Frequency of this missing skill across the candidate's recent
    // rejections at the moment of analyser upsert. Used to sort the
    // plan deterministically — highest-impact skill first.
    rejectionCount: integer("rejection_count").notNull().default(0),
    // Optional proof the candidate provides on completion. Free-form
    // URL (certificate, GitHub repo, transcript, etc.).
    verificationUrl: text("verification_url"),
  },
  (t) => ({
    perCandidateUnique: uniqueIndex("candidate_growth_skills_unique_idx").on(
      t.candidateId,
      t.skill,
    ),
    perCandidateStatusIdx: index("candidate_growth_skills_status_idx").on(
      t.candidateId,
      t.status,
    ),
  }),
);

/**
 * Audit / rate-limit table for the "Now skilled in X" re-ping
 * notifications that fire when a candidate completes a growth skill.
 *
 * Spec: re-ping each previously-rejected employer "at most once per
 * quarter per (candidate, employer)". We don't need the skill in the
 * uniqueness key — across-skill re-pings to the same employer for the
 * same candidate also need to be rate-limited so a candidate who
 * completes 3 skills in a week doesn't blast the same recruiter
 * three times.
 */
export const candidateGrowthRepingsTable = pgTable(
  "candidate_growth_repings",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Quarter bucket like "2026-Q2" — the rate-limit unique key.
    // We use a calendar quarter so a single insert-on-conflict-do-nothing
    // atomically enforces "≤1 reping per (candidate,employer) per
    // quarter" without needing a SELECT-then-INSERT race window.
    quarterKey: text("quarter_key").notNull(),
  },
  (t) => ({
    perPairIdx: index("growth_reping_pair_idx").on(
      t.candidateId,
      t.employerId,
      t.sentAt,
    ),
    quarterUnique: uniqueIndex("growth_reping_quarter_unique_idx").on(
      t.candidateId,
      t.employerId,
      t.quarterKey,
    ),
  }),
);

export type CandidateGrowthSkill =
  typeof candidateGrowthSkillsTable.$inferSelect;
export type InsertCandidateGrowthSkill =
  typeof candidateGrowthSkillsTable.$inferInsert;
export type CandidateGrowthReping =
  typeof candidateGrowthRepingsTable.$inferSelect;
