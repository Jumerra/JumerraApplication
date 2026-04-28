import { eq, inArray, sql } from "drizzle-orm";

import {
  candidateInstitutionsTable,
  db,
  institutionsTable,
} from "@workspace/db";

export type InstitutionLink = {
  id: number;
  name: string;
  type: string;
  logoUrl: string;
  isPrimary: boolean;
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
      institution: institutionsTable,
    })
    .from(candidateInstitutionsTable)
    .innerJoin(
      institutionsTable,
      eq(institutionsTable.id, candidateInstitutionsTable.institutionId),
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
 */
export async function getCandidateIdsForInstitution(
  institutionId: number,
): Promise<number[]> {
  const rows = await db
    .select({ candidateId: candidateInstitutionsTable.candidateId })
    .from(candidateInstitutionsTable)
    .where(eq(candidateInstitutionsTable.institutionId, institutionId));

  // De-dupe defensively in case a candidate ever ends up with duplicate links.
  return Array.from(new Set(rows.map((r) => r.candidateId)));
}

/**
 * Replace the full set of institution affiliations for a candidate.
 * Marks the primary as `candidates.institutionId`. Pass an empty array
 * to remove all links.
 */
export async function setCandidateInstitutionLinks(
  candidateId: number,
  primaryInstitutionId: number | null,
  additionalInstitutionIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
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
    }));

    await tx.insert(candidateInstitutionsTable).values(rows).onConflictDoNothing();
  });

  // Suppress unused-var linter: sql import kept for callers that may extend
  void sql;
}
