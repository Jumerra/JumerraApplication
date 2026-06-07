import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  usersTable,
  passwordSetupTokensTable,
  ministriesTable,
  type User,
} from "@workspace/db";

const SETUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Creates a one-time setup token and returns the relative setup link
 * the user should visit to set their password. Any prior unused tokens
 * for the same user are invalidated atomically so that, after issuing a
 * new link (e.g. on a forgot-password request), no older link can still
 * be used to take over the account.
 */
export async function createSetupToken(userId: number): Promise<{
  token: string;
  setupUrl: string;
  expiresAt: Date;
}> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(passwordSetupTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordSetupTokensTable.userId, userId),
          isNull(passwordSetupTokensTable.usedAt),
        ),
      );
    await tx.insert(passwordSetupTokensTable).values({
      userId,
      token,
      expiresAt,
    });
  });
  return {
    token,
    setupUrl: `/setup-password?token=${token}`,
    expiresAt,
  };
}

export type PublicUser = {
  id: number;
  email: string;
  fullName: string;
  role: string;
  status: string;
  orgRole: string | null;
  candidateId: number | null;
  employerId: number | null;
  institutionId: number | null;
  /**
   * For institution staffers: the department they are scoped to.
   * Null for org-wide roles (owner, registrar) and for non-institution
   * users. Surfaced on /auth/me so the frontend can build sidebar
   * filters without an extra round-trip.
   */
  assignedDepartmentId: number | null;
  /**
   * For institution staffers: the faculty they are scoped to. Used by
   * Dean roles. Null for org-wide roles and HoD roles.
   */
  assignedFacultyId: number | null;
  avatarUrl: string | null;
  phone: string | null;
  title: string | null;
  bio: string | null;
  /**
   * Admin-only opt-in for the daily trash purge heads-up email. Defaults
   * to true server-side; surfaced here so the profile UI can hydrate
   * the toggle from /auth/me without a second round-trip. Sent for every
   * role for shape stability; non-admins ignore it.
   */
  notifyTrashPurgeWarning: boolean;
  /**
   * True while the user must set a new password before using the app
   * (account was created with an admin-/owner-typed default password).
   * The web app shows a forced "set a new password" screen when true.
   */
  mustChangePassword: boolean;
  /**
   * Effective permission keys for the current user. Empty for non-admins.
   * Always present so the frontend can branch on it without nullchecks.
   */
  permissions: string[];
  /**
   * Government-ministry oversight account linkage. Null for every
   * non-ministry user. Surfaced on /auth/me so the web app can pick the
   * right dashboard + sidebar and render only the data slices the
   * super-admin has granted — without an extra round-trip.
   */
  ministryId: number | null;
  ministryType: string | null; // 'education' | 'labour'
  ministryName: string | null;
  ministryDataAccess: string[]; // granted data-scope keys (empty for non-ministry)
};

import { getUserPermissions } from "./permissions";

export async function toPublicUser(user: User): Promise<PublicUser> {
  const perms = await getUserPermissions(user);

  // Enrich ministry users with their ministry type, name, and granted
  // data-access scopes so the web app can render the right dashboard
  // without an extra round-trip. Soft-deleted ministries surface no
  // scopes (the user can sign in but sees an empty/disabled dashboard).
  let ministryType: string | null = null;
  let ministryName: string | null = null;
  let ministryDataAccess: string[] = [];
  if (user.role === "ministry" && user.ministryId) {
    const rows = await db
      .select()
      .from(ministriesTable)
      .where(
        and(
          eq(ministriesTable.id, user.ministryId),
          isNull(ministriesTable.deletedAt),
        ),
      )
      .limit(1);
    const ministry = rows[0];
    if (ministry) {
      ministryType = ministry.type;
      ministryName = ministry.name;
      ministryDataAccess = ministry.dataAccess;
    }
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    orgRole: user.orgRole,
    candidateId: user.candidateId,
    employerId: user.employerId,
    institutionId: user.institutionId,
    assignedDepartmentId: user.assignedDepartmentId ?? null,
    assignedFacultyId: user.assignedFacultyId ?? null,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    title: user.title,
    bio: user.bio,
    notifyTrashPurgeWarning: user.notifyTrashPurgeWarning ?? true,
    mustChangePassword: user.mustChangePassword ?? false,
    permissions: Array.from(perms).sort(),
    ministryId: user.ministryId ?? null,
    ministryType,
    ministryName,
    ministryDataAccess,
  };
}
