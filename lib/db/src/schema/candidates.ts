import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { institutionDepartmentsTable } from "./institutions";

export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  headline: text("headline").notNull(),
  bio: text("bio").notNull(),
  location: text("location").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  portfolioUrl: text("portfolio_url"),
  videoIntroUrl: text("video_intro_url"),
  availability: text("availability").notNull().default("open"),
  yearsExperience: integer("years_experience").notNull().default(0),
  talentScore: integer("talent_score").notNull().default(50),
  isBoosted: boolean("is_boosted").notNull().default(false),
  boostExpiresAt: timestamp("boost_expires_at", { withTimezone: true }),
  // "Open to offers" signal: candidates flag themselves as actively
  // considering opportunities so employers can filter on intent (vs.
  // talentScore which is competence). Defaults true so existing
  // candidates are surfaced; flipping false → true stamps the
  // timestamp so we can show "Open to offers since …" or sort by
  // freshness later.
  openToOffers: boolean("open_to_offers").notNull().default(true),
  openToOffersSince: timestamp("open_to_offers_since", {
    withTimezone: true,
  }).defaultNow(),
  // Opts the candidate in to the institution-scoped Alumni Mentor
  // directory. When true, other verified members of the same institution
  // can see them in the mentor browser and send a one-shot intro request.
  alumniMentorOptin: boolean("alumni_mentor_optin").notNull().default(false),
  // Opt-out from the warm-intro flow (Task #74). When false, the
  // candidate is excluded from /jobs/:id/alumni-at-employer and no
  // incoming intro requests can be created against them. Defaults
  // true so existing alumni are surfaced. The original task spec
  // called for this column on `users`, but it lives on `candidates`
  // because only candidate accounts can ever be alumni-as-target
  // (employer/institution staff never appear in alumni rosters);
  // gating at the candidate row is therefore both sufficient and
  // unambiguous. The API enforces it on both create and respond
  // paths in routes/alumni-intros.ts.
  allowIntroRequests: boolean("allow_intro_requests").notNull().default(true),
  aiCvUnlocked: boolean("ai_cv_unlocked").notNull().default(false),
  aiCvUnlockedAt: timestamp("ai_cv_unlocked_at", { withTimezone: true }),
  aiCvText: text("ai_cv_text"),
  aiCvGeneratedAt: timestamp("ai_cv_generated_at", { withTimezone: true }),
  // Primary institution affiliation (back-compat). All affiliations
  // (primary + others) live in candidate_institutions for full coverage.
  institutionId: integer("institution_id"),
  skills: text("skills").array().notNull().default([]),
  // Admin-managed background check flag. Surfaced as a badge to
  // employers (and the candidate). Stored as free text validated at
  // the API edge to keep migrations cheap. Allowed values:
  //   'not_started' | 'in_progress' | 'passed' | 'failed'
  backgroundCheckStatus: text("background_check_status")
    .notNull()
    .default("not_started"),
  backgroundCheckUpdatedAt: timestamp("background_check_updated_at", {
    withTimezone: true,
  }),
  backgroundCheckUpdatedBy: integer("background_check_updated_by"),
  // IANA timezone identifier (e.g. "America/New_York"). Used by the
  // weekly-digest worker to deliver the email + push on Monday 09:00
  // *candidate-local* time. Nullable for legacy rows; the worker falls
  // back to UTC when missing.
  timezone: text("timezone"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Candidate = typeof candidatesTable.$inferSelect;
export type InsertCandidate = typeof candidatesTable.$inferInsert;

/**
 * Many-to-many link between candidates and institutions.
 * A candidate can be affiliated with multiple institutions (e.g. a
 * university grad who later attended a bootcamp). Exactly one row per
 * (candidate, institution). The `isPrimary` flag mirrors
 * candidates.institutionId for the candidate's main affiliation.
 */
export const candidateInstitutionsTable = pgTable(
  "candidate_institutions",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    institutionId: integer("institution_id").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Verification: institutions explicitly approve a candidate as a real
    // student of theirs. Until verifiedAt is set, the candidate appears as
    // "Unverified" and is excluded from the institution's tracking metrics.
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: integer("verified_by"),
    /**
     * Optional department/program/faculty the candidate belongs to within
     * this institution. Drives per-department scoping for institution staff
     * (a coordinator with assigned_department_id sees only matching rows).
     * Set to NULL on cascade if the parent department is removed so the
     * affiliation survives as "no department".
     */
    departmentId: integer("department_id").references(
      () => institutionDepartmentsTable.id,
      { onDelete: "set null" },
    ),
  },
  (t) => ({
    candidateInstitutionUnique: uniqueIndex("candidate_institution_unique").on(
      t.candidateId,
      t.institutionId,
    ),
    // Stand-alone indexes for the reverse-direction FK lookups: the
    // /institutions/:id/students roster filters by institution_id +
    // optional department_id; per-candidate lookups (profile page,
    // verification UI) filter by candidate_id alone.
    candidateIdx: index("candidate_institutions_candidate_idx").on(t.candidateId),
    institutionIdx: index("candidate_institutions_institution_idx").on(
      t.institutionId,
    ),
    institutionDeptIdx: index("candidate_institutions_inst_dept_idx").on(
      t.institutionId,
      t.departmentId,
    ),
  }),
);

export type CandidateInstitution = typeof candidateInstitutionsTable.$inferSelect;
export type InsertCandidateInstitution =
  typeof candidateInstitutionsTable.$inferInsert;

export const educationTable = pgTable("education_entries", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  institution: text("institution").notNull(),
  degree: text("degree").notNull(),
  fieldOfStudy: text("field_of_study").notNull(),
  startYear: integer("start_year").notNull(),
  endYear: integer("end_year"),
});

export type Education = typeof educationTable.$inferSelect;

export const experienceTable = pgTable("experience_entries", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  // employerId links the entry to an existing employer in the system
  // (LinkedIn-style "pick a company"). Nullable so candidates can still
  // record roles at companies that aren't on the platform — in that case
  // `company` is the free-text fallback.
  employerId: integer("employer_id"),
  company: text("company").notNull(),
  title: text("title").notNull(),
  // employmentType mirrors LinkedIn's enum; stored as free text so future
  // values don't require a migration. Validated by Zod at the API edge.
  employmentType: text("employment_type"),
  location: text("location"),
  // locationType: 'on_site' | 'hybrid' | 'remote'. Same rationale as
  // employmentType — free text, validated at the edge.
  locationType: text("location_type"),
  description: text("description").notNull().default(""),
  startDate: date("start_date").notNull(),
  // Null endDate means "currently working here".
  endDate: date("end_date"),
});

export type Experience = typeof experienceTable.$inferSelect;

export const certificationsTable = pgTable("certifications", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  name: text("name").notNull(),
  issuer: text("issuer").notNull(),
  issuedAt: date("issued_at").notNull(),
});

export type Certification = typeof certificationsTable.$inferSelect;

export const badgesTable = pgTable("badges", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  tier: text("tier").notNull().default("bronze"),
});

export type Badge = typeof badgesTable.$inferSelect;
