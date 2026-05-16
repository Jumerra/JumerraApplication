import { and, eq, inArray } from "drizzle-orm";
import {
  candidateInstitutionsTable,
  db,
  institutionDepartmentsTable,
  type User,
} from "@workspace/db";
import { isOrgOwnerOrRegistrar } from "../middleware/require-auth";
import { getUserPermissions, isImplicitAllUser } from "./permissions";
import { getCandidateIdsForInstitution } from "./candidate-institutions";

export type InstitutionScopeResult =
  | { ok: true; departmentIds: number[] | null; orgWide: boolean }
  | { ok: false; status: number; error: string };

/**
 * Resolve the caller's allowed scope on a given institution. Mirrors
 * the rules used by GET /institutions/:id/students:
 *   - Platform admin: org-wide.
 *   - Institution staff of THIS institution holding "students:view":
 *       owner / registrar / implicit-all → org-wide
 *       dean (assignedFacultyId set)     → all departments under it
 *       hod  (assignedDepartmentId set)  → that single department
 *       dean/hod whose scope row was deleted (FK SET NULL) → DENIED
 *       coordinator/viewer (no scope)    → org-wide read
 *   - Anyone else → 403.
 *
 * Returns either an `ok: true` scope (departmentIds === null means
 * org-wide; an empty array means "scoped but no matching departments
 * yet" → produce empty result, NOT widen) or an `ok: false` HTTP
 * error envelope the caller should pass through to res.
 */
export async function resolveInstitutionScope(
  user: User | null | undefined,
  institutionId: number,
): Promise<InstitutionScopeResult> {
  if (!user) {
    return { ok: false, status: 401, error: "Authentication required" };
  }

  const isPlatformAdmin = user.role === "admin";
  const isInstStaff =
    user.role === "institution" && user.institutionId === institutionId;

  if (!isPlatformAdmin && !isInstStaff) {
    return { ok: false, status: 403, error: "Not allowed" };
  }

  if (isInstStaff && !isImplicitAllUser(user)) {
    const perms = await getUserPermissions(user);
    if (!perms.has("students:view")) {
      return {
        ok: false,
        status: 403,
        error: "Missing permission: students:view",
      };
    }
  }

  const orgWide = !isInstStaff || isOrgOwnerOrRegistrar(user);

  if (isInstStaff && !orgWide && user.orgRole === "dean") {
    if (user.assignedFacultyId == null) {
      return {
        ok: false,
        status: 403,
        error:
          "Dean has no assigned faculty; ask the registrar to reassign you.",
      };
    }
    const facultyDepts = await db
      .select({ id: institutionDepartmentsTable.id })
      .from(institutionDepartmentsTable)
      .where(
        and(
          eq(institutionDepartmentsTable.institutionId, institutionId),
          eq(institutionDepartmentsTable.facultyId, user.assignedFacultyId),
        ),
      );
    return {
      ok: true,
      orgWide: false,
      departmentIds: facultyDepts.map((d) => d.id),
    };
  }

  if (isInstStaff && !orgWide && user.orgRole === "hod") {
    if (user.assignedDepartmentId == null) {
      return {
        ok: false,
        status: 403,
        error:
          "HoD has no assigned department; ask the registrar to reassign you.",
      };
    }
    return {
      ok: true,
      orgWide: false,
      departmentIds: [user.assignedDepartmentId],
    };
  }

  return { ok: true, orgWide: true, departmentIds: null };
}

/**
 * Apply an optional caller-supplied facultyId / departmentId filter
 * on top of the resolved scope. The supplied values can only NARROW
 * the scope, never widen it: if the caller is already scoped to a
 * department, an unrelated `?departmentId=` is ignored.
 *
 * Returns the effective list of department ids to filter by, or
 * `null` for "no department filter / org-wide".
 *   - `null`            : no filter (caller is org-wide and didn't ask)
 *   - empty array       : scoped but no matching departments → caller
 *                         should produce an empty result
 *   - non-empty array   : filter to these department ids
 */
export async function narrowDepartmentScope(
  scope: InstitutionScopeResult,
  institutionId: number,
  filter: { facultyId?: number | null; departmentId?: number | null } = {},
): Promise<number[] | null> {
  if (!scope.ok) return null;
  let effective: number[] | null = scope.departmentIds;

  if (filter.facultyId != null) {
    const rows = await db
      .select({ id: institutionDepartmentsTable.id })
      .from(institutionDepartmentsTable)
      .where(
        and(
          eq(institutionDepartmentsTable.institutionId, institutionId),
          eq(institutionDepartmentsTable.facultyId, filter.facultyId),
        ),
      );
    const facultyDeptIds = rows.map((r) => r.id);
    if (effective === null) {
      effective = facultyDeptIds;
    } else {
      const allowed = new Set(effective);
      effective = facultyDeptIds.filter((id) => allowed.has(id));
    }
  }

  if (filter.departmentId != null) {
    if (effective === null) {
      effective = [filter.departmentId];
    } else if (effective.includes(filter.departmentId)) {
      effective = [filter.departmentId];
    }
    // else: caller asked for a department outside their scope → keep
    // the original scope (do NOT widen).
  }

  return effective;
}

/**
 * Convenience: resolve the candidate ids the caller is allowed to see
 * for an institution, honoring scope + optional filters. Tracking
 * metrics use VERIFIED students only.
 */
export async function getScopedStudentIds(
  institutionId: number,
  effectiveDepartmentIds: number[] | null,
): Promise<number[]> {
  if (effectiveDepartmentIds === null) {
    return getCandidateIdsForInstitution(institutionId, {
      verifiedOnly: true,
    });
  }
  if (effectiveDepartmentIds.length === 0) return [];
  if (effectiveDepartmentIds.length === 1) {
    const all = await getCandidateIdsForInstitution(institutionId, {
      verifiedOnly: true,
      departmentId: effectiveDepartmentIds[0],
    });
    return all;
  }
  const rows = await db
    .select({
      candidateId: candidateInstitutionsTable.candidateId,
      verifiedAt: candidateInstitutionsTable.verifiedAt,
    })
    .from(candidateInstitutionsTable)
    .where(
      and(
        eq(candidateInstitutionsTable.institutionId, institutionId),
        inArray(
          candidateInstitutionsTable.departmentId,
          effectiveDepartmentIds,
        ),
      ),
    );
  const ids = new Set<number>();
  for (const r of rows) {
    if (r.verifiedAt != null) ids.add(r.candidateId);
  }
  return Array.from(ids);
}
