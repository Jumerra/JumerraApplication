import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const applicationsTable = pgTable(
  "applications",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    candidateId: integer("candidate_id").notNull(),
    status: text("status").notNull().default("applied"),
    matchScore: integer("match_score").notNull().default(0),
    coverNote: text("cover_note").notNull().default(""),
    /**
     * Where the application originated. "browse" is the default for
     * regular job-detail apply CTAs; "for_you" tags swipe-right
     * submissions from the mobile For You stack so employers can
     * prioritize replies to high-intent applicants.
     */
    source: text("source").notNull().default("browse"),
    /**
     * Sort index within a Kanban column. Lower = higher in the column.
     * Defaults to 0 (new applications appear at the top of "Applied").
     * Updated by the employer Kanban via PATCH /applications/:id.
     */
    boardOrder: integer("board_order").notNull().default(0),
    /**
     * Optional self-reported salary set by the candidate AFTER the
     * application is moved to `hired`. Used (in aggregate, never per
     * row) by GET /salary-insights to power the anonymous "candidates
     * from your school in this role earned X–Y" band on the public
     * job page. Stored in the smallest currency unit consistent with
     * the rest of the platform (whole units of `reportedCurrency`).
     * Null = candidate hasn't reported, or no hire yet.
     */
    reportedSalary: integer("reported_salary"),
    reportedCurrency: text("reported_currency"),
    salaryReportedAt: timestamp("salary_reported_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // Powers the admin applications list (default sort) and any
    // recent-activity feeds.
    appliedAtIdx: index("applications_applied_at_idx").on(t.appliedAt),
    // Powers the admin hires analytics query
    // (WHERE status='hired' ... GROUP BY date_trunc(updated_at)).
    statusUpdatedAtIdx: index("applications_status_updated_at_idx").on(
      t.status,
      t.updatedAt,
    ),
    // FK lookups: the cursor-paginated /applications list joins on
    // jobs + filters on candidate_id; pre-PK these were already
    // indexed by the unique below, but a stand-alone index on
    // candidate_id helps the /candidates/:id detail pages and any
    // "my applications" view to avoid the unique-index seek penalty.
    candidateIdx: index("applications_candidate_id_idx").on(t.candidateId),
    jobIdx: index("applications_job_id_idx").on(t.jobId),
    // Composite for the employer Kanban "by-status within my jobs"
    // view; the route filters by job_id (via join) + status and
    // sorts by board_order.
    candidateStatusIdx: index("applications_candidate_status_idx").on(
      t.candidateId,
      t.status,
    ),
    jobStatusIdx: index("applications_job_status_idx").on(t.jobId, t.status),
    // Hard guarantee against duplicate applications. The
    // POST /applications and POST /jobs/:id/challenge/submit
    // endpoints both check first, but two concurrent requests
    // could otherwise both pass the check and create two rows.
    jobCandidateUniq: uniqueIndex("applications_job_candidate_uniq").on(
      t.jobId,
      t.candidateId,
    ),
  }),
);

export type Application = typeof applicationsTable.$inferSelect;
export type InsertApplication = typeof applicationsTable.$inferInsert;
