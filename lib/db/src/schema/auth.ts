import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  institutionDepartmentsTable,
  institutionFacultiesTable,
} from "./institutions";

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
 *   - disabled : admin deactivated the account; login is blocked, but the
 *                row + linked profile are preserved so it can be reactivated
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
    /**
     * Sub-role inside the user's organization (or platform). Null for
     * candidates. Allowed values per top-level role:
     *   admin       -> 'super_admin' | 'support'
     *   employer    -> 'owner' | 'recruiter' | 'viewer'
     *   institution -> 'owner' | 'registrar' | 'dean' | 'hod'
     *                  | 'coordinator' | 'viewer'
     *
     * For institutions:
     *   - 'owner' / 'registrar' have full org-wide access (registrar is a
     *     friendlier label for university operations staff).
     *   - 'dean' is scoped to their `assignedFacultyId` and may view /
     *     manage candidates and departments under that faculty.
     *   - 'hod' (head of department) is scoped to their
     *     `assignedDepartmentId` and may view / manage candidates in
     *     that single department.
     *   - 'coordinator' / 'viewer' keep their existing semantics (org
     *     or department scope; viewer = read-only).
     */
    orgRole: text("org_role"),
    /**
     * Optional department/program scope for institution staff. When set,
     * the user can only see and manage candidates affiliated with that
     * department. Null means org-wide (all departments). Owners /
     * registrars always see all and ignore this column. The FK is set
     * to NULL on cascade when the parent department is deleted,
     * downgrading the staffer to org-wide rather than orphaning them.
     */
    assignedDepartmentId: integer("assigned_department_id").references(
      (): AnyPgColumn => institutionDepartmentsTable.id,
      { onDelete: "set null" },
    ),
    /**
     * Optional faculty scope for institution staff (typically Deans).
     * When set, the user can see and manage candidates affiliated with
     * any department under that faculty. Null means no faculty scope.
     * Set to NULL on cascade when the parent faculty is deleted.
     */
    assignedFacultyId: integer("assigned_faculty_id").references(
      (): AnyPgColumn => institutionFacultiesTable.id,
      { onDelete: "set null" },
    ),
    /**
     * Universal profile fields available to every role. The candidate /
     * employer / institution tables continue to hold role-specific
     * profile data (headline, logoUrl, etc.); these columns let any user
     * (including admins and org staff) maintain a personal avatar and
     * contact info regardless of role.
     */
    avatarUrl: text("avatar_url"),
    phone: text("phone"),
    title: text("title"),
    bio: text("bio"),
    /**
     * WhatsApp number for opt-in WhatsApp notifications. Stored in
     * E.164 format ("+233241234567"). Only used when
     * `whatsappVerifiedAt` is non-null — an unverified number is never
     * used as a delivery target. Verification flow lives in
     * `routes/me.ts` (`/me/whatsapp/start-verification` + `/confirm`).
     */
    whatsappNumber: text("whatsapp_number"),
    whatsappVerifiedAt: timestamp("whatsapp_verified_at", {
      withTimezone: true,
    }),
    /** Bcrypt hash of the latest OTP. Null when no pending verification. */
    whatsappOtpHash: text("whatsapp_otp_hash"),
    whatsappOtpExpiresAt: timestamp("whatsapp_otp_expires_at", {
      withTimezone: true,
    }),
    /** Failed-attempt counter for the current pending OTP (reset on issue). */
    whatsappOtpAttempts: integer("whatsapp_otp_attempts").notNull().default(0),
    /**
     * Admin opt-in for the daily "trash purge heads-up" email sent by
     * `runTrashPurgeWarningsSweep`. Defaults to true (preserves the
     * pre-existing behaviour where every eligible admin received the
     * digest). Admins who don't want to be on cleanup duty can flip
     * this off from their profile page. Ignored for non-admin users.
     */
    notifyTrashPurgeWarning: boolean("notify_trash_purge_warning")
      .notNull()
      .default(true),
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
