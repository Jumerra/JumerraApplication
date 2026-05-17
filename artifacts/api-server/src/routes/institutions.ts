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

/**
 * URL-safe slug from an institution name. Lowercase, dashes between
 * alphanumeric runs, capped at 80 chars. Used for branded public
 * profile URLs (`/public/institutions/:slug`); falls back to numeric
 * id when slug is null or collides.
 */
function generateInstitutionSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  return base || "institution";
}

async function generateUniqueInstitutionSlug(
  name: string,
  excludeId: number | null = null,
): Promise<string> {
  const base = generateInstitutionSlug(name);
  let candidate = base;
  for (let i = 0; i < 6; i++) {
    const [row] = await db
      .select({ id: institutionsTable.id })
      .from(institutionsTable)
      .where(eq(institutionsTable.slug, candidate))
      .limit(1);
    if (!row || row.id === excludeId) return candidate;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  // Final fallback: timestamp suffix essentially guarantees uniqueness.
  return `${base}-${Date.now().toString(36)}`;
}
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
import {
  parseLimit,
  encodeCursor,
  decodeCursor,
  setNextCursor,
} from "../lib/pagination";
import { enforceStarterQuota } from "../lib/institution-quotas";
import { notDeleted } from "../lib/soft-delete";
import { isInstitutionPremium } from "./institution-subscription";

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
    slug: i.slug ?? null,
  };
  const withFlags = {
    ...base,
    publicLeaderboardEnabled: i.publicLeaderboardEnabled,
    bannerUrl: i.bannerUrl ?? null,
    featuredPrograms: i.featuredPrograms ?? null,
  };
  // Account-manager attribution is admin-only.
  if (opts.includeManager) {
    return {
      ...withFlags,
      accountManagerId: i.accountManagerId,
      accountManagerName: opts.managerName ?? null,
    };
  }
  return withFlags;
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
      and(
        notDeleted(institutionsTable.deletedAt),
        filterByManager !== null
          ? eq(institutionsTable.accountManagerId, filterByManager)
          : undefined,
      ),
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

  // Race-safe slug write: pre-check uses generateUniqueInstitutionSlug,
  // but a concurrent insert could still steal the same slug between SELECT
  // and INSERT. Catch the unique-violation (23505) and retry with a
  // random suffix so the API returns 201 instead of 500.
  let created: typeof institutionsTable.$inferSelect | undefined;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const slug = await generateUniqueInstitutionSlug(parsed.data.name);
    try {
      [created] = await db
        .insert(institutionsTable)
        .values({ ...parsed.data, slug })
        .returning();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "23505" && attempt < 2) continue;
      throw err;
    }
  }
  res.status(201).json(serializeInstitution(created!, 0, 0));
});

/**
 * Public branded institution profile.  Accepts either the URL slug or
 * the numeric id (legacy rows whose slug hasn't been generated yet
 * still resolve by id).  Mounted at `/public/institutions/:slugOrId`
 * (outside the `/institutions` requireAuth gate in routes/index.ts),
 * so anonymous visitors can view it.  Returns the same shape as
 * `GET /institutions/:id` minus admin-only fields.
 */
router.get(
  "/public/institutions/:slugOrId",
  async (req, res): Promise<void> => {
    const { slugOrId } = req.params;
    let institution: typeof institutionsTable.$inferSelect | undefined;
    if (/^\d+$/.test(slugOrId)) {
      [institution] = await db
        .select()
        .from(institutionsTable)
        .where(
          and(
            eq(institutionsTable.id, Number(slugOrId)),
            notDeleted(institutionsTable.deletedAt),
          ),
        )
        .limit(1);
    } else {
      [institution] = await db
        .select()
        .from(institutionsTable)
        .where(
          and(
            eq(institutionsTable.slug, slugOrId),
            notDeleted(institutionsTable.deletedAt),
          ),
        )
        .limit(1);
    }
    if (!institution) {
      res.status(404).json({ error: "Institution not found" });
      return;
    }
    const stats = await getInstitutionStats(institution.id);
    res.json({
      ...serializeInstitution(
        institution,
        stats.studentCount,
        stats.placementRate,
      ),
      description: institution.description,
    });
  },
);

router.get("/institutions/:id", async (req, res): Promise<void> => {
  const params = GetInstitutionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [institution] = await db
    .select()
    .from(institutionsTable)
    .where(
      and(
        eq(institutionsTable.id, params.data.id),
        notDeleted(institutionsTable.deletedAt),
      ),
    );

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
              notDeleted(jobsTable.deletedAt),
              notDeleted(employersTable.deletedAt),
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
    setNextCursor(res, null);
    res.json([]);
    return;
  }

  // Cursor pagination on (talentScore DESC, id DESC). Capped at
  // MAX_LIMIT by parseLimit so a large school's full roster ships in
  // pages rather than a single giant JSON blob.
  const limit = parseLimit((req.query as { limit?: unknown }).limit);
  type StudentsCursor = { s: number; i: number };
  const cursor = decodeCursor<StudentsCursor>(
    (req.query as { cursor?: unknown }).cursor,
  );
  const studentConditions = [
    inArray(candidatesTable.id, studentIds),
    // Don't surface soft-deleted candidates in the institution roster.
    notDeleted(candidatesTable.deletedAt),
  ];
  if (cursor) {
    studentConditions.push(
      sql`(${candidatesTable.talentScore}, ${candidatesTable.id}) < (${cursor.s}, ${cursor.i})`,
    );
  }
  const studentRows = await db
    .select()
    .from(candidatesTable)
    .where(and(...studentConditions))
    .orderBy(desc(candidatesTable.talentScore), desc(candidatesTable.id))
    .limit(limit + 1);

  const hasMore = studentRows.length > limit;
  const students = hasMore ? studentRows.slice(0, limit) : studentRows;
  const lastStudent = students[students.length - 1];
  setNextCursor(
    res,
    hasMore && lastStudent
      ? encodeCursor({ s: lastStudent.talentScore, i: lastStudent.id } satisfies StudentsCursor)
      : null,
  );

  // Heavy hydration queries below must be keyed to the CURRENT PAGE,
  // not the full scoped roster — otherwise pagination buys nothing.
  const pagedStudentIds = students.map((s) => s.id);

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
        inArray(candidateInstitutionsTable.candidateId, pagedStudentIds),
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
    .where(inArray(applicationsTable.candidateId, pagedStudentIds));

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
    // Starter quota: cap the *number* of verified students. Re-checked
    // for every verify so a race or an admin bypass can't sneak past
    // the cap. The current row (which is unverified at this point) is
    // counted *after* the verify, so we compare strictly-less-than
    // limit before inserting. Pro institutions skip this entirely.
    const quotaErr = await enforceStarterQuota(institutionId, "verifiedStudents");
    if (quotaErr) {
      res.status(quotaErr.status).json(quotaErr.body);
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

/**
 * Pro-only bulk verification. The client parses the CSV (papaparse)
 * and posts an array of `{ email, departmentId? }` rows; we match each
 * email against the `users` table (role='candidate'), then upsert a
 * verified `candidate_institutions` row per match.
 *
 * Three buckets in the response: `matched` (newly verified or
 * re-verified after an unverify), `alreadyVerified` (no-op — was
 * already verified), `unmatched` (no candidate with that email).
 *
 * Starter institutions get a 402 + `requiresUpgrade: true`. We do NOT
 * enforce the per-student Starter cap inside this route because it's
 * Pro-only — Pro removes the cap entirely.
 */
router.post(
  "/institutions/:id/students/bulk-verify",
  requireAuth,
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params["id"]);
    if (!Number.isInteger(institutionId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (!canManageInstitutionStudents(me, institutionId)) {
      res.status(403).json({ error: "Not allowed to verify this institution's students" });
      return;
    }
    if (!(await isInstitutionPremium(institutionId))) {
      res.status(402).json({
        error: "Bulk verification is an Institution Pro feature",
        requiresUpgrade: true,
        kind: "bulkVerify",
      });
      return;
    }
    const rowsRaw = (req.body as { rows?: unknown })?.rows;
    if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
      res.status(400).json({ error: "rows must be a non-empty array" });
      return;
    }
    if (rowsRaw.length > 1000) {
      res.status(400).json({ error: "Maximum 1000 rows per request" });
      return;
    }
    // Normalize input — keep only well-formed rows. We dedupe on email
    // so the same CSV row twice doesn't double-count in the response.
    const seen = new Set<string>();
    const rows: Array<{ email: string }> = [];
    for (const r of rowsRaw) {
      const email =
        typeof (r as { email?: unknown }).email === "string"
          ? (r as { email: string }).email.trim().toLowerCase()
          : "";
      if (!email || seen.has(email)) continue;
      seen.add(email);
      rows.push({ email });
    }
    if (rows.length === 0) {
      res.status(400).json({ error: "No valid rows (each must have an email)" });
      return;
    }

    // Lookup candidate user accounts by email in one batch.
    const emails = rows.map((r) => r.email);
    const userRows = await db
      .select({
        email: usersTable.email,
        candidateId: usersTable.candidateId,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "candidate"),
          inArray(usersTable.email, emails),
        ),
      );
    const candidateIdByEmail = new Map<string, number>();
    for (const u of userRows) {
      if (u.candidateId != null) candidateIdByEmail.set(u.email, u.candidateId);
    }

    const candidateIds = Array.from(candidateIdByEmail.values());
    const existingLinks =
      candidateIds.length === 0
        ? []
        : await db
            .select({
              candidateId: candidateInstitutionsTable.candidateId,
              verifiedAt: candidateInstitutionsTable.verifiedAt,
            })
            .from(candidateInstitutionsTable)
            .where(
              and(
                eq(candidateInstitutionsTable.institutionId, institutionId),
                inArray(candidateInstitutionsTable.candidateId, candidateIds),
              ),
            );
    const linkStatusByCandidate = new Map<number, "verified" | "unverified">();
    for (const l of existingLinks) {
      linkStatusByCandidate.set(
        l.candidateId,
        l.verifiedAt ? "verified" : "unverified",
      );
    }

    const matched: string[] = [];
    const alreadyVerified: string[] = [];
    const unmatched: string[] = [];
    const now = new Date();

    for (const { email } of rows) {
      const candidateId = candidateIdByEmail.get(email);
      if (candidateId == null) {
        unmatched.push(email);
        continue;
      }
      const existing = linkStatusByCandidate.get(candidateId);
      if (existing === "verified") {
        alreadyVerified.push(email);
        continue;
      }
      if (existing === "unverified") {
        await db
          .update(candidateInstitutionsTable)
          .set({ verifiedAt: now, verifiedBy: me.id })
          .where(
            and(
              eq(candidateInstitutionsTable.institutionId, institutionId),
              eq(candidateInstitutionsTable.candidateId, candidateId),
            ),
          );
      } else {
        // No affiliation row yet — create one as a verified, non-primary
        // affiliation. `isPrimary` stays false so we never silently
        // displace the candidate's own chosen primary institution.
        await db.insert(candidateInstitutionsTable).values({
          candidateId,
          institutionId,
          isPrimary: false,
          verifiedAt: now,
          verifiedBy: me.id,
        });
      }
      matched.push(email);
    }

    res.json({
      matched,
      alreadyVerified,
      unmatched,
      summary: {
        total: rows.length,
        matched: matched.length,
        alreadyVerified: alreadyVerified.length,
        unmatched: unmatched.length,
      },
    });
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
    const updates: Record<string, unknown> = { ...parsed.data };
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    // Backfill slug for legacy rows that never had one generated, but
    // do NOT regenerate on every name change — that would break every
    // previously-shared `/public/institutions/{old-slug}` link. Owners
    // who want a new vanity URL can ask support to rotate it.
    if (typeof updates.name === "string" && updates.name.trim().length > 0) {
      const [current] = await db
        .select({ slug: institutionsTable.slug })
        .from(institutionsTable)
        .where(eq(institutionsTable.id, institutionId))
        .limit(1);
      if (!current?.slug) {
        updates.slug = await generateUniqueInstitutionSlug(
          updates.name,
          institutionId,
        );
      }
    }
    // Pro-gate the branded fields. Touching either of them on a Starter
    // org returns 402 so the client can show the upgrade modal. We check
    // *presence in the patch* rather than the value, so explicitly
    // clearing back to null is also gated (cleaner upsell story).
    if ("bannerUrl" in updates || "featuredPrograms" in updates) {
      const premium = await isInstitutionPremium(institutionId);
      if (!premium) {
        res.status(402).json({
          error: "Branded profile is an Institution Pro feature",
          requiresUpgrade: true,
          kind: "brandedProfile",
        });
        return;
      }
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
    const quotaErr = await enforceStarterQuota(institutionId, "departments");
    if (quotaErr) {
      res.status(quotaErr.status).json(quotaErr.body);
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
    const quotaErr = await enforceStarterQuota(institutionId, "faculties");
    if (quotaErr) {
      res.status(quotaErr.status).json(quotaErr.body);
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
