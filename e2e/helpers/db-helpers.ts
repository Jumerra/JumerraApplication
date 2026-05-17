/** Thin DB helpers used by tests to read-back rows the API just wrote
 *  (verifying webhook unlocks, finding the staff setup token, etc.).
 *  Tests should NOT use these to bypass API auth — they're read-only
 *  assertions, not writers. */
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  pendingRegistrationsTable,
  passwordSetupTokensTable,
  candidatesTable,
  candidateInstitutionsTable,
  boostPaymentsTable,
} from "@workspace/db";

export { db, pool };

export async function findUserByEmail(email: string) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLatestPendingRegistrationForUser(userId: number) {
  const rows = await db
    .select()
    .from(pendingRegistrationsTable)
    .where(eq(pendingRegistrationsTable.userId, userId))
    .orderBy(desc(pendingRegistrationsTable.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLatestSetupTokenForUser(userId: number) {
  const rows = await db
    .select()
    .from(passwordSetupTokensTable)
    .where(eq(passwordSetupTokensTable.userId, userId))
    .orderBy(desc(passwordSetupTokensTable.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCandidateById(candidateId: number) {
  const rows = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candidateId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAffiliation(candidateId: number, institutionId: number) {
  const rows = await db
    .select()
    .from(candidateInstitutionsTable)
    .where(
      and(
        eq(candidateInstitutionsTable.candidateId, candidateId),
        eq(candidateInstitutionsTable.institutionId, institutionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getBoostPaymentBySessionId(sessionId: string) {
  const rows = await db
    .select()
    .from(boostPaymentsTable)
    .where(eq(boostPaymentsTable.stripeSessionId, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertPendingBoostPayment(args: {
  candidateId: number;
  externalRef: string;
  provider: "stripe" | "paystack";
  amount: number;
  currency: string;
  durationDays?: number;
  paystackReference?: string;
}) {
  const [row] = await db
    .insert(boostPaymentsTable)
    .values({
      candidateId: args.candidateId,
      stripeSessionId: args.externalRef,
      provider: args.provider,
      paystackReference: args.paystackReference ?? null,
      amountCents: args.amount,
      currency: args.currency,
      durationDays: args.durationDays ?? 30,
      status: "pending",
    })
    .returning();
  return row;
}
