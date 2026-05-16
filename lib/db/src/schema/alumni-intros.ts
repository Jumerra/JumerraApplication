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
import { jobsTable } from "./jobs";
import { applicationsTable } from "./applications";
import { usersTable } from "./auth";

/**
 * Warm-intro request from a candidate (the applicant) to an alumni
 * user who already works at the job's employer. Task #74.
 *
 * The throttle invariants are enforced at the route layer (lib/db
 * doesn't know about request rate), but the unique index on
 * (candidateId, alumniUserId) is intentionally NOT applied here: the
 * spec allows a fresh request after the 30-day cooldown, which a
 * unique constraint would block. The route does the timestamp check
 * explicitly instead.
 *
 * FK rules:
 *   - candidateId CASCADE: deleting the candidate clears their
 *     outstanding requests.
 *   - jobId CASCADE: ditto.
 *   - alumniUserId CASCADE: alumni account deletion clears their
 *     inbox.
 */
export const alumniIntroRequestsTable = pgTable(
  "alumni_intro_requests",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    alumniUserId: integer("alumni_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // pending | accepted | declined
    status: text("status").notNull().default("pending"),
    // Optional one-liner the alumni includes when accepting. Shows on
    // the application card as a warm endorsement.
    response: text("response"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => ({
    // Fast lookup of "what's in this alumni's inbox" + the throttle
    // check ("how many pending requests does this candidate have on
    // this job?").
    alumniInboxIdx: index("alumni_intro_alumni_idx").on(
      t.alumniUserId,
      t.status,
    ),
    candidateJobIdx: index("alumni_intro_candidate_job_idx").on(
      t.candidateId,
      t.jobId,
    ),
    candidateAlumniIdx: index("alumni_intro_candidate_alumni_idx").on(
      t.candidateId,
      t.alumniUserId,
      t.createdAt,
    ),
  }),
);

export type AlumniIntroRequest = typeof alumniIntroRequestsTable.$inferSelect;
export type InsertAlumniIntroRequest =
  typeof alumniIntroRequestsTable.$inferInsert;

// Re-export this so other modules can join applications -> intro requests
// without circular-import gymnastics; the FK target is just the table.
export { applicationsTable };
