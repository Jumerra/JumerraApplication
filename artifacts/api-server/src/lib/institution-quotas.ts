import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  candidateInstitutionsTable,
  institutionDepartmentsTable,
  institutionFacultiesTable,
  usersTable,
} from "@workspace/db";
import { isInstitutionPremium } from "../routes/institution-subscription";

type CountRow = { n: number };

/**
 * Starter ("Free") tier limits. Pro institutions ignore these
 * entirely — see `enforceStarterQuota`. Keeping the numbers in a
 * single exported constant so the server, OpenAPI dashboard
 * payload, and any future docs all agree.
 */
export const STARTER_LIMITS = {
  verifiedStudents: 100,
  faculties: 1,
  departments: 3,
  staffSeats: 2,
} as const;

export type QuotaKind = keyof typeof STARTER_LIMITS;

export type QuotaCounts = Record<QuotaKind, number>;

/**
 * Counts an institution's current usage against each Starter quota.
 * The values are the *currently consumed* slots, not the remaining
 * headroom. Pro institutions still get accurate counts so the
 * dashboard can render headline KPIs ("87 verified students") even
 * when the cap is hidden.
 */
export async function loadQuotaCounts(
  institutionId: number,
): Promise<QuotaCounts> {
  const [students, faculties, departments, staff] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(candidateInstitutionsTable)
      .where(
        and(
          eq(candidateInstitutionsTable.institutionId, institutionId),
          isNotNull(candidateInstitutionsTable.verifiedAt),
        ),
      )
      .then((r: CountRow[]) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(institutionFacultiesTable)
      .where(eq(institutionFacultiesTable.institutionId, institutionId))
      .then((r: CountRow[]) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(institutionDepartmentsTable)
      .where(eq(institutionDepartmentsTable.institutionId, institutionId))
      .then((r: CountRow[]) => Number(r[0]?.n ?? 0)),
    // Staff seats = every institution user attached to this org, in any
    // status except "rejected". `invited`/`active`/`disabled` all hold a
    // seat — only outright-rejected onboarding requests free the slot.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "institution"),
          eq(usersTable.institutionId, institutionId),
          sql`${usersTable.status} <> 'rejected'`,
        ),
      )
      .then((r: CountRow[]) => Number(r[0]?.n ?? 0)),
  ]);
  return {
    verifiedStudents: students,
    faculties,
    departments,
    staffSeats: staff,
  };
}

export type QuotaSnapshot = {
  premium: boolean;
  limits: typeof STARTER_LIMITS;
  counts: QuotaCounts;
};

export async function loadQuotaSnapshot(
  institutionId: number,
): Promise<QuotaSnapshot> {
  const [premium, counts] = await Promise.all([
    isInstitutionPremium(institutionId),
    loadQuotaCounts(institutionId),
  ]);
  return { premium, limits: STARTER_LIMITS, counts };
}

export type QuotaError = {
  status: 402;
  body: {
    error: string;
    requiresUpgrade: true;
    kind: QuotaKind;
    limit: number;
    current: number;
  };
};

/**
 * Throws-as-return: returns a `QuotaError` payload the caller should
 * forward verbatim (`res.status(err.status).json(err.body)`), or
 * `null` when the action is allowed.
 *
 * Pro institutions are always allowed (returns `null` immediately).
 * The caller is responsible for any other authorization checks —
 * this helper ONLY enforces the Starter cap.
 */
export async function enforceStarterQuota(
  institutionId: number,
  kind: QuotaKind,
): Promise<QuotaError | null> {
  if (await isInstitutionPremium(institutionId)) return null;
  const counts = await loadQuotaCounts(institutionId);
  const current = counts[kind];
  const limit = STARTER_LIMITS[kind];
  if (current < limit) return null;
  return {
    status: 402,
    body: {
      error: STARTER_LIMIT_MESSAGES[kind](limit),
      requiresUpgrade: true,
      kind,
      limit,
      current,
    },
  };
}

const STARTER_LIMIT_MESSAGES: Record<QuotaKind, (limit: number) => string> = {
  verifiedStudents: (n) =>
    `Starter institutions can verify up to ${n} students. Upgrade to Institution Pro to verify unlimited students.`,
  faculties: (n) =>
    `Starter institutions are limited to ${n} faculty. Upgrade to Institution Pro to add more.`,
  departments: (n) =>
    `Starter institutions are limited to ${n} departments. Upgrade to Institution Pro to add more.`,
  staffSeats: (n) =>
    `Starter institutions are limited to ${n} staff seats. Upgrade to Institution Pro to invite more teammates.`,
};
