import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { applicationsTable } from "./applications";
import { employersTable } from "./employers";
import { usersTable } from "./auth";

/**
 * One interview invitation = one employer offering 1..N candidate-pickable
 * time slots for a specific application.
 *
 * Status lifecycle:
 *   proposed  -> employer sent N slots, waiting on candidate
 *   accepted  -> candidate picked one slot (selectedSlotId set, respondedAt set)
 *   declined  -> candidate declined the whole invite (declineReason optional)
 *   cancelled -> employer pulled the invite back
 *
 * The application's status is auto-flipped to 'interview' on creation and
 * acceptance so the existing employer pipeline stays in sync.
 */
export const interviewInvitesTable = pgTable(
  "interview_invites",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    // Nullable so we can preserve historical invites when the
    // user who created them is removed (e.g. employee offboarded).
    createdByUserId: integer("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("proposed"),
    location: text("location").notNull().default(""),
    meetingLink: text("meeting_link").notNull().default(""),
    notes: text("notes").notNull().default(""),
    selectedSlotId: integer("selected_slot_id"),
    declineReason: text("decline_reason").notNull().default(""),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    inviteApplicationIdx: index("interview_invites_application_idx").on(
      t.applicationId,
    ),
    inviteEmployerIdx: index("interview_invites_employer_idx").on(t.employerId),
    inviteStatusIdx: index("interview_invites_status_idx").on(t.status),
  }),
);

/**
 * Each row is one proposed time slot belonging to an invite.  When the
 * candidate accepts, `selectedSlotId` on the invite points at one of
 * these rows.
 */
export const interviewTimeSlotsTable = pgTable(
  "interview_time_slots",
  {
    id: serial("id").primaryKey(),
    inviteId: integer("invite_id")
      .notNull()
      .references(() => interviewInvitesTable.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slotInviteIdx: index("interview_time_slots_invite_idx").on(t.inviteId),
  }),
);

export const interviewInvitesRelations = relations(
  interviewInvitesTable,
  ({ one, many }) => ({
    application: one(applicationsTable, {
      fields: [interviewInvitesTable.applicationId],
      references: [applicationsTable.id],
    }),
    employer: one(employersTable, {
      fields: [interviewInvitesTable.employerId],
      references: [employersTable.id],
    }),
    timeSlots: many(interviewTimeSlotsTable),
  }),
);

export const interviewTimeSlotsRelations = relations(
  interviewTimeSlotsTable,
  ({ one }) => ({
    invite: one(interviewInvitesTable, {
      fields: [interviewTimeSlotsTable.inviteId],
      references: [interviewInvitesTable.id],
    }),
  }),
);

export type InterviewInvite = typeof interviewInvitesTable.$inferSelect;
export type InsertInterviewInvite = typeof interviewInvitesTable.$inferInsert;
export type InterviewTimeSlot = typeof interviewTimeSlotsTable.$inferSelect;
export type InsertInterviewTimeSlot =
  typeof interviewTimeSlotsTable.$inferInsert;
