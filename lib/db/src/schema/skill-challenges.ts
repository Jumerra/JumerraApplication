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
    templateIds: jsonb("template_ids").notNull().default(sql`'[]'::jsonb`),
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
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairUniq: uniqueIndex("application_challenges_candidate_job_uniq").on(
      t.candidateId,
      t.jobId,
    ),
    appIdx: index("application_challenges_application_idx").on(
      t.applicationId,
    ),
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
