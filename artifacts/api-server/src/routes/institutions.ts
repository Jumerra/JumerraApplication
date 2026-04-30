import { Router, type IRouter } from "express";
import { eq, inArray, sql, desc, and, asc } from "drizzle-orm";
import {
  db,
  institutionsTable,
  institutionDepartmentsTable,
  institutionFacilitiesTable,
  institutionFacultiesTable,
  candidatesTable,
  candidateInstitutionsTable,
  applicationsTable,
  jobsTable,
  employersTable,
  type InstitutionDepartment,
  type InstitutionFacility,
  type InstitutionFaculty,
} from "@workspace/db";
import {
  CreateInstitutionBody,
  GetInstitutionParams,
  ListInstitutionStudentsParams,
  ListInstitutionStudentsQueryParams,
  UpdateMyInstitutionBody,
  CreateMyInstitutionDepartmentBody,
  UpdateMyInstitutionDepartmentBody,
  UpdateMyInstitutionDepartmentParams,
  CreateMyInstitutionFacilityBody,
  UpdateMyInstitutionFacilityBody,
  UpdateMyInstitutionFacilityParams,
  CreateMyInstitutionFacultyBody,
  UpdateMyInstitutionFacultyBody,
  UpdateMyInstitutionFacultyParams,
} from "@workspace/api-zod";
import {
  getCandidateIdsForInstitution,
  getInstitutionIdForDepartment,
} from "../lib/candidate-institutions";
import {
  requireAdmin,
  requireAuth,
  isOrgOwnerOrRegistrar,
} from "../middleware/require-auth";
import {
  requirePermission,
  getUserPermissions,
  isImplicitAllUser,
} from "../lib/permissions";
import { usersTable, notificationsTable } from "@workspace/db";

/**
 * Best-effort: drop a notification on the candidate's user account so
 * they see institution-verification activity in their bell. Failure is
 * logged but never fails the parent request — verification succeeded
 * regardless.
 */
async function notifyCandidateAboutVerification(
  candidateId: number,
  institutionName: string,
  verified: boolean,
  log: { error: (...args: unknown[]) => void },
): Promise<void> {
  try {
    const [u] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.candidateId, candidateId))
      .limit(1);
    if (!u) return;
    if (verified) {
      await db.insert(notificationsTable).values({
        userId: u.id,
        kind: "institution_verified",
        title: `${institutionName} verified your attendance`,
        body: `Your profile now shows a "Verified" badge for ${institutionName}.`,
        link: "/profile",
      });
    } else {
      await db.insert(notificationsTable).values({
        userId: u.id,
        kind: "institution_unverified",
        title: `${institutionName} removed your verification`,
        body: `Your "Verified" badge for ${institutionName} has been removed. Please contact the institution if this was a mistake.`,
        link: "/profile",
      });
    }
  } catch (err) {
    log.error({ err }, "notifyCandidateAboutVerification failed");
  }
}

const router: IRouter = Router();

async function getInstitutionStats(institutionId: number) {
  // Tracking metrics use VERIFIED students only — institutions can't claim
  // placement credit for someone they haven't actually verified as a student.
  const studentIds = await getCandidateIdsForInstitution(institutionId, {
    verifiedOnly: true,
  });

  if (studentIds.length === 0) {
    return { studentCount: 0, placementRate: 0 };
  }

  const hires = await db
    .select({ candidateId: applicationsTable.candidateId })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.status, "hired"),
        inArray(applicationsTable.candidateId, studentIds),
      ),
    );

  const placedIds = new Set(hires.map((h) => h.candidateId));
  return {
    studentCount: studentIds.length,
    placementRate: placedIds.size / studentIds.length,
  };
}

function serializeDepartment(d: InstitutionDepartment) {
  return {
    id: d.id,
    institutionId: d.institutionId,
    facultyId: d.facultyId,
    name: d.name,
    code: d.code,
    headName: d.headName,
    description: d.description,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function serializeFaculty(f: InstitutionFaculty) {
  return {
    id: f.id,
    institutionId: f.institutionId,
    name: f.name,
    code: f.code,
    deanName: f.deanName,
    description: f.description,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

function serializeFacility(f: InstitutionFacility) {
  return {
    id: f.id,
    institutionId: f.institutionId,
    name: f.name,
    kind: f.kind,
    location: f.location,
    description: f.description,
    capacity: f.capacity,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

/**
 * Resolve the institution id the caller can manage. Owners (and
 * coordinators/viewers for reads) of an institution operate against
 * their own institutionId; platform admins must pick one explicitly,
 * which we don't support on the /me routes — they should use the
 * id-scoped endpoints. Returns null when the caller has no institution.
 */
function resolveCallerInstitutionId(
  user: { role: string; institutionId: number | null },
): number | null {
  if (user.role !== "institution") return null;
  return user.institutionId;
}

function serializeInstitution(
  i: typeof institutionsTable.$inferSelect,
  studentCount: number,
  placementRate: number,
  opts: { managerName?: string | null; includeManager?: boolean } = {},
) {
  const base = {
    id: i.id,
    name: i.name,
    type: i.type,
    location: i.location,
    logoUrl: i.logoUrl,
    websiteUrl: i.websiteUrl,
    studentCount,
    placementRate,
    createdAt: i.createdAt.toISOString(),
  };
  // Account-manager attribution is admin-only.
  if (opts.includeManager) {
    return {
      ...base,
      accountManagerId: i.accountManagerId,
      accountManagerName: opts.managerName ?? null,
    };
  }
  return base;
}

// Note: a global `requireAuth` is mounted on `/institutions` in
// `routes/index.ts`, so `req.currentUser` is always populated here.
router.get("/institutions", async (req, res): Promise<void> => {
  const viewer = req.currentUser ?? null;
  const isAdmin = viewer?.role === "admin";
  const mine = req.query.mine === "1" || req.query.mine === "true";
  const filterByManager =
    isAdmin && mine && viewer?.orgRole === "account_manager"
      ? viewer.id
      : null;

  const all = await db
    .select()
    .from(institutionsTable)
    .where(
      filterByManager !== null
        ? eq(institutionsTable.accountManagerId, filterByManager)
        : undefined,
    )
    .orderBy(institutionsTable.name);

  if (all.length === 0) {
    res.json([]);
    return;
  }

  // Resolve manager names in one batched query (admin viewers only).
  const managerNameById = new Map<number, string>();
  if (isAdmin) {
    const managerIds = Array.from(
      new Set(
        all.map((i) => i.accountManagerId).filter((v): v is number => v != null),
      ),
    );
    if (managerIds.length > 0) {
      const managers = await db
        .select({ id: usersTable.id, fullName: usersTable.fullName })
        .from(usersTable)
        .where(inArray(usersTable.id, managerIds));
      for (const m of managers) managerNameById.set(m.id, m.fullName);
    }
  }

  // Compute per-institution student count + placement rate in TWO queries
  // total (instead of 2*N) to avoid the obvious N+1 scaling cliff.
  // Tracking metrics use VERIFIED links only.
  const institutionIds = all.map((i) => i.id);

  const linkRows = await db
    .select({
      institutionId: candidateInstitutionsTable.institutionId,
      candidateId: candidateInstitutionsTable.candidateId,
      verifiedAt: candidateInstitutionsTable.verifiedAt,
    })
    .from(candidateInstitutionsTable)
    .where(inArray(candidateInstitutionsTable.institutionId, institutionIds));

  const studentsByInst = new Map<number, Set<number>>();
  const allStudentIds = new Set<number>();
  for (const r of linkRows) {
    if (r.verifiedAt == null) continue; // unverified links don't count
    let set = studentsByInst.get(r.institutionId);
    if (!set) {
      set = new Set<number>();
      studentsByInst.set(r.institutionId, set);
    }
    set.add(r.candidateId);
    allStudentIds.add(r.candidateId);
  }

  const hiredIds = new Set<number>();
  if (allStudentIds.size > 0) {
    const hires = await db
      .select({ candidateId: applicationsTable.candidateId })
      .from(applicationsTable)
      .where(
        and(
          eq(applicationsTable.status, "hired"),
          inArray(applicationsTable.candidateId, Array.from(allStudentIds)),
        ),
      );
    for (const h of hires) hiredIds.add(h.candidateId);
  }

  const result = all.map((i) => {
    const studentSet = studentsByInst.get(i.id);
    const studentCount = studentSet?.size ?? 0;
    let placedCount = 0;
    if (studentSet) {
      for (const cid of studentSet) {
        if (hiredIds.has(cid)) placedCount += 1;
      }
    }
    const placementRate = studentCount === 0 ? 0 : placedCount / studentCount;
    return serializeInstitution(i, studentCount, placementRate, {
      includeManager: isAdmin,
      managerName:
        i.accountManagerId != null
          ? managerNameById.get(i.accountManagerId) ?? null
          : null,
    });
  });

  res.json(result);
});

router.post("/institutions", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateInstitutionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [created] = await db.insert(institutionsTable).values(parsed.data).returning();
  res.status(201).json(serializeInstitution(created, 0, 0));
});

router.get("/institutions/:id", async (req, res): Promise<void> => {
  const params = GetInstitutionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [institution] = await db
    .select()
    .from(institutionsTable)
    .where(eq(institutionsTable.id, params.data.id));

  if (!institution) {
    res.status(404).json({ error: "Institution not found" });
    return;
  }

  const stats = await getInstitutionStats(institution.id);

  // Top employers that hired students from this institution (any affiliation)
  const studentIdsForEmployers = await getCandidateIdsForInstitution(institution.id);
  const hires =
    studentIdsForEmployers.length === 0
      ? []
      : await db
          .select({ employer: employersTable })
          .from(applicationsTable)
          .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
          .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
          .where(
            and(
              inArray(applicationsTable.candidateId, studentIdsForEmployers),
              eq(applicationsTable.status, "hired"),
            ),
          );

  const employerMap = new Map<number, typeof employersTable.$inferSelect>();
  for (const { employer } of hires) {
    employerMap.set(employer.id, employer);
  }
  const partnerEmployers = Array.from(employerMap.values()).map((e) => ({
    id: e.id,
    name: e.name,
    tagline: e.tagline,
    description: e.description,
    industry: e.industry,
    location: e.location,
    logoUrl: e.logoUrl,
    coverUrl: e.coverUrl,
    websiteUrl: e.websiteUrl,
    size: e.size,
    verified: e.verified,
    openJobs: 0,
    createdAt: e.createdAt.toISOString(),
  }));

  const [departments, facilities, faculties] = await Promise.all([
    db
      .select()
      .from(institutionDepartmentsTable)
      .where(eq(institutionDepartmentsTable.institutionId, institution.id))
      .orderBy(asc(institutionDepartmentsTable.name)),
    db
      .select()
      .from(institutionFacilitiesTable)
      .where(eq(institutionFacilitiesTable.institutionId, institution.id))
      .orderBy(asc(institutionFacilitiesTable.name)),
    db
      .select()
      .from(institutionFacultiesTable)
      .where(eq(institutionFacultiesTable.institutionId, institution.id))
      .orderBy(asc(institutionFacultiesTable.name)),
  ]);

  res.json({
    ...serializeInstitution(institution, stats.studentCount, stats.placementRate),
    description: institution.description,
    partnerEmployers,
    departments: departments.map(serializeDepartment),
    facilities: facilities.map(serializeFacility),
    faculties: faculties.map(serializeFaculty),
  });
});

router.get(
  "/institutions/:id/students",
  requireAuth,
  async (req, res): Promise<void> => {
  const params = ListInstitutionStudentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const queryParams = ListInstitutionStudentsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  // Authorization: this roster is sensitive student PII. Only allow:
  //   * platform admins (any orgRole) — they can audit any institution
  //   * institution staff of THIS institution who hold "students:view"
  // Anyone else (other-org staff, candidates, employers) gets 403.
  const me = req.currentUser!;
  const isPlatformAdmin = me.role === "admin";
  const isInstStaffOfThisInst =
    me.role === "institution" && me.institutionId === params.data.id;
  if (!isPlatformAdmin && !isInstStaffOfThisInst) {
    res.status(403).json({ error: "Not allowed to view this roster" });
    return;
  }
  if (isInstStaffOfThisInst && !isImplicitAllUser(me)) {
    const perms = await getUserPermissions(me);
    if (!perms.has("students:view")) {
      res
        .status(403)
        .json({ error: "Missing permission: students:view" });
      return;
    }
  }

  // Server-side scoping for institution staff:
  //   * HoD (assignedDepartmentId)  → restricted to that single department
  //   * Dean (assignedFacultyId)    → restricted to every department
  //                                    under that faculty
  //   * Owner / Registrar / admin   → org-wide; may opt-in via
  //                                    `?departmentId=`
  // Non-owner staff cannot widen their view by changing/omitting the
  // query param: their assignment overrides the request value.
  // A dean/HoD whose scope row was deleted (FK SET NULL) is denied
  // entirely below — we never silently broaden them to org-wide.
  const hasOrgWideAccess =
    !isInstStaffOfThisInst || isOrgOwnerOrRegistrar(me);

  // Reject scoped roles (dean / hod) whose required scope assignment
  // has been cleared (e.g. faculty/department deleted via FK SET NULL).
  // Without this guard they would fall through into the "both null →
  // org-wide" branch and see every student.
  if (
    isInstStaffOfThisInst &&
    !hasOrgWideAccess &&
    me.orgRole === "dean" &&
    me.assignedFacultyId == null
  ) {
    res
      .status(403)
      .json({ error: "Dean has no assigned faculty; ask the registrar to reassign you." });
    return;
  }
  if (
    isInstStaffOfThisInst &&
    !hasOrgWideAccess &&
    me.orgRole === "hod" &&
    me.assignedDepartmentId == null
  ) {
    res
      .status(403)
      .json({ error: "HoD has no assigned department; ask the registrar to reassign you." });
    return;
  }

  let scopedDepartmentIds: number[] | null = null;
  if (!hasOrgWideAccess) {
    if (me.assignedDepartmentId != null) {
      scopedDepartmentIds = [me.assignedDepartmentId];
    } else if (me.assignedFacultyId != null) {
      const facultyDepts = await db
        .select({ id: institutionDepartmentsTable.id })
        .from(institutionDepartmentsTable)
        .where(
          and(
            eq(institutionDepartmentsTable.institutionId, params.data.id),
            eq(institutionDepartmentsTable.facultyId, me.assignedFacultyId),
          ),
        );
      // Empty list = dean assigned to a faculty with no departments yet.
      // Returning [] here yields an empty student list, which is correct.
      scopedDepartmentIds = facultyDepts.map((d) => d.id);
    }
  }

  const requestedDepartmentId = queryParams.data.departmentId ?? null;

  // Combine the staff scope with any opt-in `?departmentId=` filter.
  // For org-wide callers, the requested filter is honored as-is.
  // For scoped callers, the requested value must lie within their scope
  // or it's ignored (we never widen).
  let effectiveDepartmentIds: number[] | null = scopedDepartmentIds;
  if (
    requestedDepartmentId != null &&
    (effectiveDepartmentIds === null ||
      effectiveDepartmentIds.includes(requestedDepartmentId))
  ) {
    effectiveDepartmentIds = [requestedDepartmentId];
  }

  let studentIds: number[];
  if (effectiveDepartmentIds === null) {
    studentIds = await getCandidateIdsForInstitution(params.data.id);
  } else if (effectiveDepartmentIds.length === 0) {
    studentIds = [];
  } else if (effectiveDepartmentIds.length === 1) {
    studentIds = await getCandidateIdsForInstitution(params.data.id, {
      departmentId: effectiveDepartmentIds[0],
    });
  } else {
    const rows = await db
      .select({ candidateId: candidateInstitutionsTable.candidateId })
      .from(candidateInstitutionsTable)
      .where(
        and(
          eq(candidateInstitutionsTable.institutionId, params.data.id),
          inArray(
            candidateInstitutionsTable.departmentId,
            effectiveDepartmentIds,
          ),
        ),
      );
    studentIds = Array.from(new Set(rows.map((r) => r.candidateId)));
  }

  if (studentIds.length === 0) {
    res.json([]);
    return;
  }

  const students = await db
    .select()
    .from(candidatesTable)
    .where(inArray(candidatesTable.id, studentIds))
    .orderBy(desc(candidatesTable.talentScore));

  // Determine whether each student's link to this institution is primary
  // so the UI can flag transfer / multi-affiliation students, and whether
  // this institution has VERIFIED them as a real student. Also pull the
  // resolved department + faculty name so the table can render them
  // without a second round-trip.
  const linkRows = await db
    .select({
      candidateId: candidateInstitutionsTable.candidateId,
      isPrimary: candidateInstitutionsTable.isPrimary,
      verifiedAt: candidateInstitutionsTable.verifiedAt,
      departmentId: candidateInstitutionsTable.departmentId,
      departmentName: institutionDepartmentsTable.name,
      facultyId: institutionDepartmentsTable.facultyId,
      facultyName: institutionFacultiesTable.name,
      verifiedByName: usersTable.fullName,
    })
    .from(candidateInstitutionsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, candidateInstitutionsTable.verifiedBy),
    )
    .leftJoin(
      institutionDepartmentsTable,
      eq(
        institutionDepartmentsTable.id,
        candidateInstitutionsTable.departmentId,
      ),
    )
    .leftJoin(
      institutionFacultiesTable,
      eq(institutionFacultiesTable.id, institutionDepartmentsTable.facultyId),
    )
    .where(
      and(
        eq(candidateInstitutionsTable.institutionId, params.data.id),
        inArray(candidateInstitutionsTable.candidateId, studentIds),
      ),
    );
  const linkInfoByCandidate = new Map<
    number,
    {
      isPrimary: boolean;
      isVerified: boolean;
      verifiedAt: string | null;
      verifiedByName: string | null;
      departmentId: number | null;
      departmentName: string | null;
      facultyId: number | null;
      facultyName: string | null;
    }
  >(
    linkRows.map((r) => [
      r.candidateId,
      {
        isPrimary: r.isPrimary,
        isVerified: r.verifiedAt != null,
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        verifiedByName: r.verifiedByName,
        departmentId: r.departmentId,
        departmentName: r.departmentName,
        facultyId: r.facultyId,
        facultyName: r.facultyName,
      },
    ]),
  );

  const apps = await db
    .select({
      candidateId: applicationsTable.candidateId,
      status: applicationsTable.status,
      employerName: employersTable.name,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(inArray(applicationsTable.candidateId, studentIds));

  const statsByCandidate = new Map<number, { count: number; status: string; employerName: string | null }>();
  for (const a of apps) {
    const existing = statsByCandidate.get(a.candidateId) ?? { count: 0, status: "active", employerName: null };
    existing.count += 1;
    if (a.status === "hired") {
      existing.status = "hired";
      existing.employerName = a.employerName;
    } else if (existing.status !== "hired") {
      if (a.status === "interview" || a.status === "offer") existing.status = "interviewing";
      else if (a.status === "applied" || a.status === "screening") {
        if (existing.status === "active") existing.status = "applying";
      }
    }
    statsByCandidate.set(a.candidateId, existing);
  }

  res.json(
    students.map((s) => {
      const stats = statsByCandidate.get(s.id) ?? { count: 0, status: "active", employerName: null };
      const link = linkInfoByCandidate.get(s.id);
      return {
        candidateId: s.id,
        fullName: s.fullName,
        avatarUrl: s.avatarUrl,
        headline: s.headline,
        talentScore: s.talentScore,
        readinessScore: Math.min(100, s.talentScore + (s.skills.length * 2)),
        status: stats.status,
        currentEmployerName: stats.employerName,
        applicationsCount: stats.count,
        isPrimaryAffiliation: link?.isPrimary ?? false,
        isVerified: link?.isVerified ?? false,
        verifiedAt: link?.verifiedAt ?? null,
        verifiedByName: link?.verifiedByName ?? null,
        departmentId: link?.departmentId ?? null,
        departmentName: link?.departmentName ?? null,
        facultyId: link?.facultyId ?? null,
        facultyName: link?.facultyName ?? null,
      };
    }),
  );
  },
);

/**
 * Authorization helper for verify/unverify: caller must be either a
 * platform admin OR an institution member (not viewer) of the SAME
 * institution being acted on. We do this inline because the standard
 * org-member helper doesn't compare URL params against the session's
 * institutionId.
 */
function canManageInstitutionStudents(
  user: { role: string; orgRole: string | null; institutionId: number | null },
  institutionId: number,
): boolean {
  if (user.role === "admin") return true;
  if (user.role !== "institution") return false;
  if (user.institutionId !== institutionId) return false;
  // Viewers can't change verification status. Owners, registrars,
  // coordinators, deans, and HoDs all can (HoDs and Deans are further
  // department/faculty-scoped via canActOnCandidateAffiliation below).
  return (
    user.orgRole === "owner" ||
    user.orgRole === "registrar" ||
    user.orgRole === "coordinator" ||
    user.orgRole === "dean" ||
    user.orgRole === "hod"
  );
}

/**
 * Per-department / per-faculty scoping check for verify/unverify.
 * Returns true when the actor either has org-wide access (owner /
 * registrar / admin / unscoped staff) OR the candidate's affiliation
 * row falls within the actor's assigned scope:
 *   * HoD: candidate's department === assignedDepartmentId
 *   * Dean: candidate's department's faculty === assignedFacultyId
 * Returns false when a scoped staffer attempts to act on a candidate
 * outside their scope or on a candidate without an affiliation row.
 */
async function canActOnCandidateAffiliation(
  user: typeof usersTable.$inferSelect,
  institutionId: number,
  candidateId: number,
): Promise<boolean> {
  if (isOrgOwnerOrRegistrar(user)) return true;
  // Dean/HoD MUST have a scope row. If their faculty/department was
  // deleted (FK SET NULL) they lose access until the registrar
  // reassigns them — we never silently fall back to org-wide.
  if (user.orgRole === "dean" && user.assignedFacultyId == null) {
    return false;
  }
  if (user.orgRole === "hod" && user.assignedDepartmentId == null) {
    return false;
  }
  // Other staff (coordinators, viewers, etc.) without any scope are
  // treated as org-wide acting users — they were intentionally not
  // restricted by the registrar.
  if (user.assignedDepartmentId == null && user.assignedFacultyId == null) {
    return true;
  }
  const [link] = await db
    .select({
      departmentId: candidateInstitutionsTable.departmentId,
      facultyId: institutionDepartmentsTable.facultyId,
    })
    .from(candidateInstitutionsTable)
    .leftJoin(
      institutionDepartmentsTable,
      eq(
        institutionDepartmentsTable.id,
        candidateInstitutionsTable.departmentId,
      ),
    )
    .where(
      and(
        eq(candidateInstitutionsTable.institutionId, institutionId),
        eq(candidateInstitutionsTable.candidateId, candidateId),
      ),
    )
    .limit(1);
  if (!link) return false;
  if (
    user.assignedDepartmentId != null &&
    link.departmentId === user.assignedDepartmentId
  ) {
    return true;
  }
  if (
    user.assignedFacultyId != null &&
    link.facultyId === user.assignedFacultyId
  ) {
    return true;
  }
  return false;
}

router.post(
  "/institutions/:id/students/:candidateId/verify",
  requireAuth,
  requirePermission("students:verify"),
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params["id"]);
    const candidateId = Number(req.params["candidateId"]);
    if (!Number.isInteger(institutionId) || !Number.isInteger(candidateId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (!canManageInstitutionStudents(me, institutionId)) {
      res.status(403).json({ error: "Not allowed to verify this institution's students" });
      return;
    }
    if (!(await canActOnCandidateAffiliation(me, institutionId, candidateId))) {
      res.status(403).json({ error: "This student is outside your assigned department" });
      return;
    }
    const result = await db
      .update(candidateInstitutionsTable)
      .set({ verifiedAt: new Date(), verifiedBy: me.id })
      .where(
        and(
          eq(candidateInstitutionsTable.institutionId, institutionId),
          eq(candidateInstitutionsTable.candidateId, candidateId),
        ),
      )
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Student is not linked to this institution" });
      return;
    }
    const [inst] = await db
      .select({ name: institutionsTable.name })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, institutionId))
      .limit(1);
    await notifyCandidateAboutVerification(
      candidateId,
      inst?.name ?? "Your institution",
      true,
      req.log,
    );
    res.json({ ok: true, verifiedAt: result[0]!.verifiedAt!.toISOString() });
  },
);

router.post(
  "/institutions/:id/students/:candidateId/unverify",
  requireAuth,
  requirePermission("students:verify"),
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params["id"]);
    const candidateId = Number(req.params["candidateId"]);
    if (!Number.isInteger(institutionId) || !Number.isInteger(candidateId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (!canManageInstitutionStudents(me, institutionId)) {
      res.status(403).json({ error: "Not allowed to unverify this institution's students" });
      return;
    }
    if (!(await canActOnCandidateAffiliation(me, institutionId, candidateId))) {
      res.status(403).json({ error: "This student is outside your assigned department" });
      return;
    }
    const result = await db
      .update(candidateInstitutionsTable)
      .set({ verifiedAt: null, verifiedBy: null })
      .where(
        and(
          eq(candidateInstitutionsTable.institutionId, institutionId),
          eq(candidateInstitutionsTable.candidateId, candidateId),
        ),
      )
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Student is not linked to this institution" });
      return;
    }
    const [inst] = await db
      .select({ name: institutionsTable.name })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, institutionId))
      .limit(1);
    await notifyCandidateAboutVerification(
      candidateId,
      inst?.name ?? "Your institution",
      false,
      req.log,
    );
    res.json({ ok: true });
  },
);

// ── Self-service institution management (caller's own institution) ──

/**
 * Owners of the caller's own institution can update its profile fields.
 * Platform admins can use the admin-scoped routes; this endpoint is
 * specifically for the institution owner managing their own org.
 */
router.patch(
  "/institutions/me",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res
        .status(403)
        .json({ error: "Owner or registrar access required" });
      return;
    }
    const parsed = UpdateMyInstitutionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [updated] = await db
      .update(institutionsTable)
      .set(updates)
      .where(eq(institutionsTable.id, institutionId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Institution not found" });
      return;
    }
    const stats = await getInstitutionStats(updated.id);
    res.json(serializeInstitution(updated, stats.studentCount, stats.placementRate));
  },
);

// ── Departments ──

router.get(
  "/institutions/me/departments",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    const rows = await db
      .select()
      .from(institutionDepartmentsTable)
      .where(eq(institutionDepartmentsTable.institutionId, institutionId))
      .orderBy(asc(institutionDepartmentsTable.name));
    res.json(rows.map(serializeDepartment));
  },
);

/**
 * Validate that a faculty id (when provided) is owned by the caller's
 * institution. Returns true on success or when `facultyId` is
 * null/undefined; false when the id refers to a faculty that doesn't
 * exist or belongs to another institution.
 */
async function facultyBelongsToInstitution(
  facultyId: number | null | undefined,
  institutionId: number,
): Promise<boolean> {
  if (facultyId == null) return true;
  const [row] = await db
    .select({ id: institutionFacultiesTable.id })
    .from(institutionFacultiesTable)
    .where(
      and(
        eq(institutionFacultiesTable.id, facultyId),
        eq(institutionFacultiesTable.institutionId, institutionId),
      ),
    )
    .limit(1);
  return row != null;
}

router.post(
  "/institutions/me/departments",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res.status(403).json({ error: "Owner or registrar access required" });
      return;
    }
    const parsed = CreateMyInstitutionDepartmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (
      !(await facultyBelongsToInstitution(
        parsed.data.facultyId ?? null,
        institutionId,
      ))
    ) {
      res
        .status(400)
        .json({ error: "Faculty does not belong to this institution" });
      return;
    }
    try {
      const [created] = await db
        .insert(institutionDepartmentsTable)
        .values({
          institutionId,
          facultyId: parsed.data.facultyId ?? null,
          name: parsed.data.name,
          code: parsed.data.code ?? null,
          headName: parsed.data.headName ?? null,
          description: parsed.data.description ?? null,
        })
        .returning();
      res.status(201).json(serializeDepartment(created!));
    } catch (err) {
      // Unique violation (institution_id, name)
      if (
        err instanceof Error &&
        /duplicate key|unique/i.test(err.message ?? "")
      ) {
        res.status(409).json({ error: "Department name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/institutions/me/departments/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res.status(403).json({ error: "Owner or registrar access required" });
      return;
    }
    const params = UpdateMyInstitutionDepartmentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateMyInstitutionDepartmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    if (
      "facultyId" in updates &&
      !(await facultyBelongsToInstitution(
        updates.facultyId ?? null,
        institutionId,
      ))
    ) {
      res
        .status(400)
        .json({ error: "Faculty does not belong to this institution" });
      return;
    }
    try {
      const [updated] = await db
        .update(institutionDepartmentsTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(
          and(
            eq(institutionDepartmentsTable.id, params.data.id),
            // Crucial: institution scoping — owners can only modify their own.
            eq(institutionDepartmentsTable.institutionId, institutionId),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Department not found" });
        return;
      }
      res.json(serializeDepartment(updated));
    } catch (err) {
      if (
        err instanceof Error &&
        /duplicate key|unique/i.test(err.message ?? "")
      ) {
        res.status(409).json({ error: "Department name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/institutions/me/departments/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res.status(403).json({ error: "Owner or registrar access required" });
      return;
    }
    const params = UpdateMyInstitutionDepartmentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const result = await db
      .delete(institutionDepartmentsTable)
      .where(
        and(
          eq(institutionDepartmentsTable.id, params.data.id),
          eq(institutionDepartmentsTable.institutionId, institutionId),
        ),
      )
      .returning({ id: institutionDepartmentsTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// ── Faculties ──

router.get(
  "/institutions/me/faculties",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    const rows = await db
      .select()
      .from(institutionFacultiesTable)
      .where(eq(institutionFacultiesTable.institutionId, institutionId))
      .orderBy(asc(institutionFacultiesTable.name));
    res.json(rows.map(serializeFaculty));
  },
);

router.post(
  "/institutions/me/faculties",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res.status(403).json({ error: "Owner or registrar access required" });
      return;
    }
    const parsed = CreateMyInstitutionFacultyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const [created] = await db
        .insert(institutionFacultiesTable)
        .values({
          institutionId,
          name: parsed.data.name,
          code: parsed.data.code ?? null,
          deanName: parsed.data.deanName ?? null,
          description: parsed.data.description ?? null,
        })
        .returning();
      res.status(201).json(serializeFaculty(created!));
    } catch (err) {
      if (
        err instanceof Error &&
        /duplicate key|unique/i.test(err.message ?? "")
      ) {
        res.status(409).json({ error: "Faculty name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/institutions/me/faculties/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res.status(403).json({ error: "Owner or registrar access required" });
      return;
    }
    const params = UpdateMyInstitutionFacultyParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateMyInstitutionFacultyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    try {
      const [updated] = await db
        .update(institutionFacultiesTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(
          and(
            eq(institutionFacultiesTable.id, params.data.id),
            eq(institutionFacultiesTable.institutionId, institutionId),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Faculty not found" });
        return;
      }
      res.json(serializeFaculty(updated));
    } catch (err) {
      if (
        err instanceof Error &&
        /duplicate key|unique/i.test(err.message ?? "")
      ) {
        res.status(409).json({ error: "Faculty name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/institutions/me/faculties/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res.status(403).json({ error: "Owner or registrar access required" });
      return;
    }
    const params = UpdateMyInstitutionFacultyParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const result = await db
      .delete(institutionFacultiesTable)
      .where(
        and(
          eq(institutionFacultiesTable.id, params.data.id),
          eq(institutionFacultiesTable.institutionId, institutionId),
        ),
      )
      .returning({ id: institutionFacultiesTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Faculty not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// ── Facilities ──

router.get(
  "/institutions/me/facilities",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    const rows = await db
      .select()
      .from(institutionFacilitiesTable)
      .where(eq(institutionFacilitiesTable.institutionId, institutionId))
      .orderBy(asc(institutionFacilitiesTable.name));
    res.json(rows.map(serializeFacility));
  },
);

router.post(
  "/institutions/me/facilities",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res
        .status(403)
        .json({ error: "Owner or registrar access required" });
      return;
    }
    const parsed = CreateMyInstitutionFacilityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const [created] = await db
        .insert(institutionFacilitiesTable)
        .values({
          institutionId,
          name: parsed.data.name,
          kind: parsed.data.kind,
          location: parsed.data.location ?? null,
          description: parsed.data.description ?? null,
          capacity: parsed.data.capacity ?? null,
        })
        .returning();
      res.status(201).json(serializeFacility(created!));
    } catch (err) {
      if (
        err instanceof Error &&
        /duplicate key|unique/i.test(err.message ?? "")
      ) {
        res.status(409).json({ error: "Facility name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/institutions/me/facilities/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res
        .status(403)
        .json({ error: "Owner or registrar access required" });
      return;
    }
    const params = UpdateMyInstitutionFacilityParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateMyInstitutionFacilityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    try {
      const [updated] = await db
        .update(institutionFacilitiesTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(
          and(
            eq(institutionFacilitiesTable.id, params.data.id),
            eq(institutionFacilitiesTable.institutionId, institutionId),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Facility not found" });
        return;
      }
      res.json(serializeFacility(updated));
    } catch (err) {
      if (
        err instanceof Error &&
        /duplicate key|unique/i.test(err.message ?? "")
      ) {
        res.status(409).json({ error: "Facility name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/institutions/me/facilities/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    const institutionId = resolveCallerInstitutionId(me);
    if (institutionId == null) {
      res.status(403).json({ error: "Not associated with an institution" });
      return;
    }
    if (!isOrgOwnerOrRegistrar(me)) {
      res
        .status(403)
        .json({ error: "Owner or registrar access required" });
      return;
    }
    const params = UpdateMyInstitutionFacilityParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const result = await db
      .delete(institutionFacilitiesTable)
      .where(
        and(
          eq(institutionFacilitiesTable.id, params.data.id),
          eq(institutionFacilitiesTable.institutionId, institutionId),
        ),
      )
      .returning({ id: institutionFacilitiesTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Facility not found" });
      return;
    }
    res.json({ ok: true });
  },
);

export default router;
