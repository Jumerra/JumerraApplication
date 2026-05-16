import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { institutionsTable } from "./institutions";
import { candidatesTable } from "./candidates";

/**
 * Institution-owned cohorts (e.g. "Class of 2026"). Used to slice
 * placement analytics by graduating year. Cascades on institution
 * delete. (year, institutionId) is unique so we don't accidentally
 * create two rows for the same graduating class.
 */
export const candidateCohortsTable = pgTable(
  "candidate_cohorts",
  {
    id: serial("id").primaryKey(),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    cohortInstIdx: index("candidate_cohort_inst_idx").on(t.institutionId),
    cohortInstYearUnique: uniqueIndex("candidate_cohort_inst_year_idx").on(
      t.institutionId,
      t.year,
    ),
  }),
);

export type CandidateCohort = typeof candidateCohortsTable.$inferSelect;
export type InsertCandidateCohort = typeof candidateCohortsTable.$inferInsert;

/**
 * Members of a cohort. Cascade on cohort delete; cascade on candidate
 * delete (if the candidate is removed from the platform we don't keep
 * dangling membership rows).
 */
export const candidateCohortMembersTable = pgTable(
  "candidate_cohort_members",
  {
    id: serial("id").primaryKey(),
    cohortId: integer("cohort_id")
      .notNull()
      .references(() => candidateCohortsTable.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    cohortMemberUnique: uniqueIndex("candidate_cohort_member_unique").on(
      t.cohortId,
      t.candidateId,
    ),
    cohortMemberCohortIdx: index("candidate_cohort_member_cohort_idx").on(
      t.cohortId,
    ),
    cohortMemberCandidateIdx: index(
      "candidate_cohort_member_candidate_idx",
    ).on(t.candidateId),
  }),
);

export type CandidateCohortMember =
  typeof candidateCohortMembersTable.$inferSelect;
export type InsertCandidateCohortMember =
  typeof candidateCohortMembersTable.$inferInsert;
