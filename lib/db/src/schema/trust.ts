import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { candidatesTable } from "./candidates";
import { institutionsTable } from "./institutions";
import { usersTable } from "./auth";

/**
 * Per-skill verifications issued by an institution to one of its
 * affiliated students. The same (candidate, institution, skill) tuple
 * may exist many times historically; only rows with `revokedAt IS NULL`
 * count as currently active. The unique partial index in db:push handles
 * "one active row per tuple" — for portability we leave it loose at the
 * schema level and enforce uniqueness in the route handler.
 */
export const candidateSkillVerificationsTable = pgTable(
  "candidate_skill_verifications",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    issuedBy: integer("issued_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    note: text("note"),
  },
  (t) => ({
    candSkillCandIdx: index("cand_skill_cand_idx").on(t.candidateId),
    candSkillInstIdx: index("cand_skill_inst_idx").on(t.institutionId),
  }),
);

export type CandidateSkillVerification =
  typeof candidateSkillVerificationsTable.$inferSelect;
export type InsertCandidateSkillVerification =
  typeof candidateSkillVerificationsTable.$inferInsert;

/**
 * Reference requests created by candidates. The candidate enters a
 * referee email + relationship and the system mints a single-use
 * `token` that the referee uses on a public form to submit answers.
 *
 * Submitted answers (`submittedRefereeName`, `submittedRefereeRole`,
 * `wouldRehire`, `strengths`) live on the same row.
 *
 * `hiddenAt` lets institution staff (or the candidate themselves)
 * suppress a submitted reference from public view — we never edit or
 * delete the original answers (audit trail).
 *
 * Referee email is stored to dedupe + (future) re-send the link, but
 * is NEVER returned to candidate-facing or employer-facing surfaces;
 * only the submitted name + role are public.
 */
export const candidateReferencesTable = pgTable(
  "candidate_references",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    refereeEmail: text("referee_email").notNull(),
    relationship: text("relationship").notNull(), // 'lecturer' | 'past_employer' | 'colleague' | 'other'
    token: text("token").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedRefereeName: text("submitted_referee_name"),
    submittedRefereeRole: text("submitted_referee_role"),
    wouldRehire: boolean("would_rehire"),
    strengths: text("strengths"),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: integer("hidden_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    candRefTokenUnique: uniqueIndex("cand_ref_token_unique").on(t.token),
    candRefCandIdx: index("cand_ref_cand_idx").on(t.candidateId),
  }),
);

export type CandidateReference = typeof candidateReferencesTable.$inferSelect;
export type InsertCandidateReference =
  typeof candidateReferencesTable.$inferInsert;
