import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Application users (real auth-backed accounts). Distinct from the
 * legacy demo "View as" mode. A user is linked to at most one
 * candidate / employer / institution row depending on their role.
 *
 * status:
 *   - pending  : signed up, awaiting admin review
 *   - active   : approved and (for password-based logins) password set
 *   - rejected : admin denied the registration
 *   - invited  : admin onboarded; awaiting password setup via token
 */
export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    role: text("role").notNull(), // candidate | employer | institution | admin
    status: text("status").notNull().default("pending"),
    fullName: text("full_name").notNull(),
    candidateId: integer("candidate_id"),
    employerId: integer("employer_id"),
    institutionId: integer("institution_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => ({
    userEmailUnique: uniqueIndex("user_email_unique").on(t.email),
  }),
);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;

/**
 * Snapshot of the data the user submitted at sign-up time. We keep it
 * separate from the entity tables (candidates/employers/institutions)
 * because those rows are only created upon admin approval.
 */
export const pendingRegistrationsTable = pgTable(
  "pending_registrations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    submittedData: jsonb("submitted_data").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: integer("reviewed_by"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pendingRegUserIdx: index("pending_reg_user_idx").on(t.userId),
  }),
);

export type PendingRegistration =
  typeof pendingRegistrationsTable.$inferSelect;
export type InsertPendingRegistration =
  typeof pendingRegistrationsTable.$inferInsert;

/**
 * One-time tokens used by admin-onboarded users to set their initial
 * password. Tokens expire after 7 days and are invalidated on use.
 */
export const passwordSetupTokensTable = pgTable(
  "password_setup_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pwTokenUnique: uniqueIndex("pw_token_unique").on(t.token),
  }),
);

export type PasswordSetupToken =
  typeof passwordSetupTokensTable.$inferSelect;
export type InsertPasswordSetupToken =
  typeof passwordSetupTokensTable.$inferInsert;

/**
 * Session storage table for connect-pg-simple. The schema is fixed by
 * connect-pg-simple — do not change column names/types.
 */
export const sessionsTable = pgTable(
  "session",
  {
    sid: text("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (t) => ({
    sessionExpireIdx: index("IDX_session_expire").on(t.expire),
  }),
);
