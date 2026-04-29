import { eq, inArray, sql, and, isNotNull } from "drizzle-orm";

import {
  candidateInstitutionsTable,
  db,
  institutionDepartmentsTable,
  institutionsTable,
  usersTable,
} from "@workspace/db";

export type InstitutionLink = {
  id: number;
  name: string;
  type: string;
  logoUrl: string;
  isPrimary: boolean;
  isVerified: boolean;
  verifiedAt: string | null;
  verifiedByName: string | null;
  departmentId: number | null;
  departmentName: string | null;
};

/**
 * Fetch all institution affiliations for a set of candidates,
 * grouped by candidate id. The resulting array per candidate is
 * sorted with the primary affiliation first, then alphabetically.
 *
 * Returns an empty Map if no candidate ids are provided.
 */
export async function getInstitutionLinksByCandidate(
  candidateIds: number[],
): Promise<Map<number, InstitutionLink[]>> {
  const map = new Map<number, InstitutionLink[]>();
  if (candidateIds.length === 0) return map;

  const rows = await db
    .select({
      candidateId: candidateInstitutionsTable.candidateId,
      isPrimary: candidateInstitutionsTable.isPrimary,
      verifiedAt: candidateInstitutionsTable.verifiedAt,
      verifiedByName: usersTable.fullName,
      departmentId: candidateInstitutionsTable.departmentId,
      departmentName: institutionDepartmentsTable.name,
      institution: institutionsTable,
    })
    .from(candidateInstitutionsTable)
    .innerJoin(
      institutionsTable,
      eq(institutionsTable.id, candidateInstitutionsTable.institutionId),
    )
    .leftJoin(
      institutionDepartmentsTable,
      eq(
        institutionDepartmentsTable.id,
        candidateInstitutionsTable.departmentId,
      ),
    )
    .leftJoin(
      usersTable,
      eq(usersTable.id, candidateInstitutionsTable.verifiedBy),
    )
    .where(inArray(candidateInstitutionsTable.candidateId, candidateIds));

  for (const row of rows) {
    const list = map.get(row.candidateId) ?? [];
    list.push({
      id: row.institution.id,
      name: row.institution.name,
      type: row.institution.type,
      logoUrl: row.institution.logoUrl,
      isPrimary: row.isPrimary,
      isVerified: row.verifiedAt != null,
      verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
      verifiedByName: row.verifiedByName,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
    });
    map.set(row.candidateId, list);
  }

  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return map;
}

/**
 * Find every candidate id linked to a given institution (whether
 * that institution is the primary affiliation or a secondary one).
 *
 * Pass `verifiedOnly: true` to restrict the result to candidates the
 * institution has explicitly verified — used for tracking metrics where
 * unverified students should not count.
 *
 * Pass `departmentId` to scope to a single department/program. Used for
 * per-department coordinator scoping and the owner-side dept filter.
 */
export async function getCandidateIdsForInstitution(
  institutionId: number,
  opts: { verifiedOnly?: boolean; departmentId?: number } = {},
): Promise<number[]> {
  const filters = [eq(candidateInstitutionsTable.institutionId, institutionId)];
  if (opts.verifiedOnly) {
    filters.push(isNotNull(candidateInstitutionsTable.verifiedAt));
  }
  if (typeof opts.departmentId === "number") {
    filters.push(
      eq(candidateInstitutionsTable.departmentId, opts.departmentId),
    );
  }

  const rows = await db
    .select({ candidateId: candidateInstitutionsTable.candidateId })
    .from(candidateInstitutionsTable)
    .where(and(...filters));

  // De-dupe defensively in case a candidate ever ends up with duplicate links.
  return Array.from(new Set(rows.map((r) => r.candidateId)));
}

/**
 * Look up the institution that a department belongs to, or null if the
 * department id does not exist. Useful for cross-org validation when
 * accepting a department id from a request body.
 */
export async function getInstitutionIdForDepartment(
  departmentId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ institutionId: institutionDepartmentsTable.institutionId })
    .from(institutionDepartmentsTable)
    .where(eq(institutionDepartmentsTable.id, departmentId))
    .limit(1);
  return row?.institutionId ?? null;
}

/**
 * Replace the full set of institution affiliations for a candidate.
 * Marks the primary as `candidates.institutionId`. Pass an empty array
 * to remove all links. Existing per-affiliation `departmentId`s are
 * preserved across re-runs so a re-save of the primary affiliation does
 * not silently clear the student's program.
 */
export async function setCandidateInstitutionLinks(
  candidateId: number,
  primaryInstitutionId: number | null,
  additionalInstitutionIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    // Snapshot current departmentId per institution so we can restore
    // them when we recreate the rows below (the simplest implementation
    // is delete + insert; preserving deptId keeps the student's program
    // intact even when only the primary flag is being toggled).
    const existing = await tx
      .select({
        institutionId: candidateInstitutionsTable.institutionId,
        departmentId: candidateInstitutionsTable.departmentId,
      })
      .from(candidateInstitutionsTable)
      .where(eq(candidateInstitutionsTable.candidateId, candidateId));
    const deptByInst = new Map<number, number | null>();
    for (const r of existing) deptByInst.set(r.institutionId, r.departmentId);

    await tx
      .delete(candidateInstitutionsTable)
      .where(eq(candidateInstitutionsTable.candidateId, candidateId));

    const all = new Set<number>(additionalInstitutionIds);
    if (primaryInstitutionId != null) all.add(primaryInstitutionId);

    if (all.size === 0) return;

    const rows = Array.from(all).map((institutionId) => ({
      candidateId,
      institutionId,
      isPrimary: institutionId === primaryInstitutionId,
      departmentId: deptByInst.get(institutionId) ?? null,
    }));

    await tx.insert(candidateInstitutionsTable).values(rows).onConflictDoNothing();
  });

  // Suppress unused-var linter: sql import kept for callers that may extend
  void sql;
}

/**
 * Update the per-affiliation department for a candidate at a single
 * institution. Inserts the affiliation row if it does not yet exist
 * (so a candidate self-selecting a program also creates the link).
 * The caller is responsible for validating that `departmentId`
 * (when non-null) belongs to `institutionId`.
 */
export async function setCandidateAffiliationDepartment(
  candidateId: number,
  institutionId: number,
  departmentId: number | null,
): Promise<void> {
  const [existing] = await db
    .select({ id: candidateInstitutionsTable.id })
    .from(candidateInstitutionsTable)
    .where(
      and(
        eq(candidateInstitutionsTable.candidateId, candidateId),
        eq(candidateInstitutionsTable.institutionId, institutionId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(candidateInstitutionsTable)
      .set({ departmentId })
      .where(eq(candidateInstitutionsTable.id, existing.id));
    return;
  }

  await db.insert(candidateInstitutionsTable).values({
    candidateId,
    institutionId,
    isPrimary: false,
    departmentId,
  });
}
