import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const jobsTable = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    employerId: integer("employer_id").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    location: text("location").notNull(),
    remote: boolean("remote").notNull().default(false),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    currency: text("currency").notNull().default("USD"),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    responsibilities: text("responsibilities").array().notNull().default([]),
    requirements: text("requirements").array().notNull().default([]),
    benefits: text("benefits").array().notNull().default([]),
    skills: text("skills").array().notNull().default([]),
    /**
     * Legacy "Featured" flag, retained so existing data + admin tools
     * keep working. The new freemium tier system supersedes it for
     * public ranking.
     */
    featured: boolean("featured").notNull().default(false),
    /**
     * Per-job pricing tier. 'free' = unpaid (default), 'promoted' =
     * paid one-shot for higher ranking, 'sponsored' = paid one-shot
     * for higher ranking + active push to matching candidates.
     */
    tier: text("tier").notNull().default("free"),
    /**
     * When the current paid tier expires. Null for free jobs. A nightly
     * sweep (or any GET /jobs call) demotes expired rows back to 'free'.
     */
    tierExpiresAt: timestamp("tier_expires_at", { withTimezone: true }),
    /**
     * Optional targeting filters used when fanning out a Sponsored job
     * to candidates. Empty array / null means "no targeting filter on
     * this dimension". Targeting is best-effort — Sponsored push is
     * also subject to the admin-configured per-job cap.
     */
    targetSkills: text("target_skills").array().notNull().default([]),
    targetLocation: text("target_location"),
    /**
     * 'public' (default) — appears in marketplace listings and search.
     * 'private' — does NOT appear in /jobs or matches. Used for the
     * private bridge-jobs created when a reverse offer is accepted,
     * so accepted compensation and role detail never leaks publicly.
     */
    visibility: text("visibility").notNull().default("public"),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete marker. Null = active. See lib/soft-delete.ts.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    jobsTierIdx: index("jobs_tier_idx").on(t.tier, t.tierExpiresAt),
  }),
);

export type Job = typeof jobsTable.$inferSelect;
export type InsertJob = typeof jobsTable.$inferInsert;
