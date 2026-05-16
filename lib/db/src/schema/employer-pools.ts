import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { employersTable } from "./employers";
import { candidatesTable } from "./candidates";
import { usersTable } from "./auth";

/**
 * Saved Talent Pool — a private, employer-scoped shortlist of candidates
 * a recruiter wants to come back to (e.g. "2027 grads — frontend").
 * Pools are NOT shared across orgs.
 */
export const employerTalentPoolsTable = pgTable(
  "employer_talent_pools",
  {
    id: serial("id").primaryKey(),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdBy: integer("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    employerNameIdx: uniqueIndex("employer_talent_pool_name_idx").on(
      t.employerId,
      t.name,
    ),
  }),
);

export type EmployerTalentPool =
  typeof employerTalentPoolsTable.$inferSelect;
export type InsertEmployerTalentPool =
  typeof employerTalentPoolsTable.$inferInsert;

/**
 * Membership join table for talent pools. `tags` is a free-text array
 * the recruiter uses to bucket candidates inside a pool (e.g.
 * ["frontend", "ghana"]).
 */
export const employerTalentPoolMembersTable = pgTable(
  "employer_talent_pool_members",
  {
    id: serial("id").primaryKey(),
    poolId: integer("pool_id")
      .notNull()
      .references(() => employerTalentPoolsTable.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    tags: text("tags").array().notNull().default([]),
    addedBy: integer("added_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    poolCandidateUnique: uniqueIndex(
      "employer_talent_pool_member_unique",
    ).on(t.poolId, t.candidateId),
    poolIdx: index("employer_talent_pool_member_pool_idx").on(t.poolId),
  }),
);

export type EmployerTalentPoolMember =
  typeof employerTalentPoolMembersTable.$inferSelect;
export type InsertEmployerTalentPoolMember =
  typeof employerTalentPoolMembersTable.$inferInsert;

/**
 * Reusable outreach message template. Placeholders supported:
 *   {{firstName}}, {{jobTitle}}, {{employerName}}
 * Stored per-employer; not shared across orgs.
 */
export const employerMessageTemplatesTable = pgTable(
  "employer_message_templates",
  {
    id: serial("id").primaryKey(),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    createdBy: integer("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    employerNameIdx: uniqueIndex("employer_message_template_name_idx").on(
      t.employerId,
      t.name,
    ),
  }),
);

export type EmployerMessageTemplate =
  typeof employerMessageTemplatesTable.$inferSelect;
export type InsertEmployerMessageTemplate =
  typeof employerMessageTemplatesTable.$inferInsert;

/**
 * Per-recipient log of every templated outreach sent. One row per
 * (sender, candidate) so we can show "you contacted Ama 2 weeks ago",
 * dedupe within a day's bulk-send, and enforce per-org daily caps.
 */
export const employerOutreachMessagesTable = pgTable(
  "employer_outreach_messages",
  {
    id: serial("id").primaryKey(),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    senderUserId: integer("sender_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    poolId: integer("pool_id").references(
      () => employerTalentPoolsTable.id,
      { onDelete: "set null" },
    ),
    templateId: integer("template_id").references(
      () => employerMessageTemplatesTable.id,
      { onDelete: "set null" },
    ),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    /** "in_app" | "email_queued" | "email_sent" — for the (currently
     * stubbed) email queue; in-app is always written synchronously. */
    deliveryStatus: text("delivery_status").notNull().default("in_app"),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    employerSentIdx: index("employer_outreach_sent_idx").on(
      t.employerId,
      t.sentAt,
    ),
  }),
);

export type EmployerOutreachMessage =
  typeof employerOutreachMessagesTable.$inferSelect;
export type InsertEmployerOutreachMessage =
  typeof employerOutreachMessagesTable.$inferInsert;
