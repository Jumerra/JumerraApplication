import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  usersTable,
  passwordSetupTokensTable,
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
  candidateId: number | null;
  employerId: number | null;
  institutionId: number | null;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    candidateId: user.candidateId,
    employerId: user.employerId,
    institutionId: user.institutionId,
  };
}
