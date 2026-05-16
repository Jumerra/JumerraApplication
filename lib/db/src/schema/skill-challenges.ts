import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { jobsTable } from "./jobs";
import { applicationsTable } from "./applications";
import { candidatesTable } from "./candidates";

/**
 * A reusable bank of skill-assessment questions keyed by `skill`
 * (lowercased). The auto-generator picks one template per job skill;
 * employers may also swap templates in/out at job-creation time.
 *
 * `questions` is a JSON array of MCQ items:
 *   [{ prompt: string, options: string[], correctIndex: number }, ...]
 *
 * The `correctIndex` is NEVER returned to candidates — the sanitiser
 * in routes/skill-challenges.ts strips it before responding.
 */
export const challengeTemplatesTable = pgTable(
  "challenge_templates",
  {
    id: serial("id").primaryKey(),
    skill: text("skill").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    difficulty: text("difficulty").notNull().default("medium"),
    questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    skillIdx: index("challenge_templates_skill_idx").on(t.skill),
  }),
);

/**
 * A snapshot of the questions attached to a specific job. Stored
 * inline (not via FK to templates) so an employer's customisations
 * survive template edits and the candidate sees the exact same
 * questions later, even if the source template changes.
 */
export const jobChallengesTable = pgTable(
  "job_challenges",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Skill challenge"),
    questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`),
    passingScore: integer("passing_score").notNull().default(0),
    /** Estimated time-to-complete in seconds. Surfaced as
     * "Challenge: ~N min" on the candidate apply gate and job detail. */
    durationSeconds: integer("duration_seconds").notNull().default(300),
    templateIds: jsonb("template_ids").notNull().default(sql`'[]'::jsonb`),
    /** Per-question employer overrides — { index, prompt?, options?, correctIndex? }
     * applied on top of the template snapshot at apply-time. Kept as a
     * separate array so the original template questions remain auditable. */
    overrides: jsonb("overrides").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    jobIdUniq: uniqueIndex("job_challenges_job_id_uniq").on(t.jobId),
  }),
);

/**
 * Candidate's submission against a job challenge. The (candidateId,
 * jobId) pair is unique — a candidate can take a given job's
 * challenge once. `applicationId` is populated either at the same
 * time (the submit endpoint creates the application atomically) or
 * later (back-fill for legacy applications). Score is 0–100.
 */
export const applicationChallengesTable = pgTable(
  "application_challenges",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id").references(
      () => applicationsTable.id,
      { onDelete: "cascade" },
    ),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(0),
    answers: jsonb("answers").notNull().default(sql`'[]'::jsonb`),
    /** Per-question grading breakdown:
     * [{ index, prompt, chosen, correct, isCorrect }]. Surfaced on the
     * employer application card so reviewers can see WHICH questions
     * the candidate got right, not just the overall score. */
    breakdown: jsonb("breakdown").notNull().default(sql`'[]'::jsonb`),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairUniq: uniqueIndex("application_challenges_candidate_job_uniq").on(
      t.candidateId,
      t.jobId,
    ),
    /** One submission per application (the submit endpoint enforces
     * this by short-circuiting on retake; the unique index turns any
     * race condition into a 23505 we catch and convert to "already
     * submitted"). Partial so legacy NULL applicationId rows are
     * excluded from the constraint. */
    appUniq: uniqueIndex("application_challenges_application_uniq")
      .on(t.applicationId)
      .where(sql`${t.applicationId} IS NOT NULL`),
  }),
);

export type ChallengeTemplate = typeof challengeTemplatesTable.$inferSelect;
export type JobChallenge = typeof jobChallengesTable.$inferSelect;
export type ApplicationChallenge =
  typeof applicationChallengesTable.$inferSelect;

export type ChallengeQuestion = {
  prompt: string;
  options: string[];
  correctIndex: number;
};

export type ChallengeBreakdownItem = {
  index: number;
  prompt: string;
  chosen: number;
  correct: number;
  isCorrect: boolean;
};
