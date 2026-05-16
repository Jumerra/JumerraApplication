import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { candidatesTable } from "./candidates";
import { jobsTable } from "./jobs";
import { applicationsTable } from "./applications";

/**
 * AI-led mock interview a candidate takes for a specific job. The
 * questions are tuned per (job.skills, job.requirements, candidate
 * yearsExperience). Each answer is scored by the LLM against a
 * three-dimension rubric (technical, communication, culture) and the
 * aggregate is computed on `finalise`. The most recent finalised row
 * for (candidateId, jobId) is attached to any application the
 * candidate later submits, so employers see "Mock interview: 87/100"
 * alongside the keyword-driven match score.
 *
 * `status` lifecycle:
 *   in_progress → answers being submitted, sub-scores accumulating
 *   finalised   → transcript is immutable, sub-scores + overall set
 *   abandoned   → started but never finalised (cleanup / retake)
 */
export const mockInterviewsTable = pgTable(
  "mock_interviews",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    /**
     * Set when the candidate applies after finalising the interview.
     * Nullable because the interview can exist without an application
     * (taken first, applied later — or never).
     */
    applicationId: integer("application_id").references(
      () => applicationsTable.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("in_progress"),
    rubricVersion: text("rubric_version").notNull().default("v1"),
    /**
     * The 6–8 generated questions, frozen at start time so retake-
     * after-job-edits doesn't shift the prompts mid-flight.
     * Shape: Array<{ id: number; text: string; focus: 'technical' | 'communication' | 'culture' }>
     */
    questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`),
    /**
     * Append-only per-answer log. Every POST /answer pushes a new
     * entry. Shape:
     * Array<{
     *   questionIndex: number;
     *   question: string;
     *   answer: string;
     *   scores: { technical: number; communication: number; culture: number };
     *   feedback: string;
     *   answeredAt: string; // ISO
     * }>
     */
    transcript: jsonb("transcript").notNull().default(sql`'[]'::jsonb`),
    scoreOverall: integer("score_overall"),
    scoreTechnical: integer("score_technical"),
    scoreCommunication: integer("score_communication"),
    scoreCulture: integer("score_culture"),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    // Powers "latest finalised interview for (candidate, job)" lookup
    // when an application is created.
    byCandidateJob: index("mock_interviews_candidate_job_idx").on(
      t.candidateId,
      t.jobId,
      t.completedAt,
    ),
    // At most one in-progress interview per (candidate, job). Lets
    // retake = finalise (or abandon) the prior row, then start a new
    // one. PostgreSQL allows multiple rows where status != 'in_progress'
    // because the partial WHERE excludes them.
    oneInProgressPerJob: uniqueIndex(
      "mock_interviews_one_in_progress_per_job",
    )
      .on(t.candidateId, t.jobId)
      .where(sql`status = 'in_progress'`),
  }),
);

export type MockInterview = typeof mockInterviewsTable.$inferSelect;
export type InsertMockInterview = typeof mockInterviewsTable.$inferInsert;

export type MockInterviewQuestion = {
  id: number;
  text: string;
  focus: "technical" | "communication" | "culture";
};

export type MockInterviewTranscriptEntry = {
  questionIndex: number;
  question: string;
  answer: string;
  /** Focus axis of the question this answer addressed; used by the
   *  per-axis weighted aggregation at finalise time. */
  focus: "technical" | "communication" | "culture";
  scores: {
    technical: number;
    communication: number;
    culture: number;
  };
  feedback: string;
  answeredAt: string;
};
