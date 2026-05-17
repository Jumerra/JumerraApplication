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
  adminRolesTable,
  adminRolePermissionsTable,
} from "@workspace/db";

/**
 * The boot-time seedSystemRoles() in api-server seeds roles for every
 * org that exists at startup; orgs created mid-test (via approval)
 * don't get their roles until the server restarts. This helper
 * mirrors the institution-scope role definitions from
 * artifacts/api-server/src/lib/permissions.ts so the e2e suite can
 * invite staff against a newly-approved institution.
 */
const INSTITUTION_PERMS = [
  "students:view",
  "students:invite",
  "students:verify",
  "placements:view",
  "analytics:view",
  "staff:view",
  "staff:manage",
  "departments:manage",
  "faculties:manage",
  "institution:manage",
  "subscription:manage",
];

const INSTITUTION_ROLES: Array<{ name: string; perms: string[] }> = [
  { name: "owner", perms: INSTITUTION_PERMS },
  { name: "registrar", perms: INSTITUTION_PERMS },
  {
    name: "dean",
    perms: [
      "students:view",
      "students:invite",
      "students:verify",
      "placements:view",
      "analytics:view",
      "staff:view",
    ],
  },
  {
    name: "hod",
    perms: [
      "students:view",
      "students:invite",
      "students:verify",
      "placements:view",
      "analytics:view",
      "staff:view",
    ],
  },
  {
    name: "coordinator",
    perms: [
      "students:view",
      "students:invite",
      "students:verify",
      "placements:view",
      "analytics:view",
      "staff:view",
    ],
  },
  {
    name: "viewer",
    perms: [
      "students:view",
      "placements:view",
      "analytics:view",
      "staff:view",
    ],
  },
];

export async function ensureInstitutionRoles(institutionId: number) {
  for (const role of INSTITUTION_ROLES) {
    const existing = await db
      .select({ id: adminRolesTable.id })
      .from(adminRolesTable)
      .where(
        and(
          eq(adminRolesTable.scope, "institution"),
          eq(adminRolesTable.institutionId, institutionId),
          eq(adminRolesTable.name, role.name),
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;
    const [created] = await db
      .insert(adminRolesTable)
      .values({
        scope: "institution",
        institutionId,
        employerId: null,
        name: role.name,
        description: `e2e seeded ${role.name}`,
        isSystem: true,
      })
      .returning({ id: adminRolesTable.id });
    if (role.perms.length > 0) {
      await db.insert(adminRolePermissionsTable).values(
        role.perms.map((permission) => ({ roleId: created.id, permission })),
      );
    }
  }
}

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
