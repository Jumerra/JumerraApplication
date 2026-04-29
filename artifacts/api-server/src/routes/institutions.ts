import { Router, type IRouter } from "express";
import { eq, inArray, sql, desc, and, asc } from "drizzle-orm";
import {
  db,
  institutionsTable,
  institutionDepartmentsTable,
  institutionFacilitiesTable,
  candidatesTable,
  candidateInstitutionsTable,
  applicationsTable,
  jobsTable,
  employersTable,
  type InstitutionDepartment,
  type InstitutionFacility,
} from "@workspace/db";
import {
  CreateInstitutionBody,
  GetInstitutionParams,
  ListInstitutionStudentsParams,
  UpdateMyInstitutionBody,
  CreateMyInstitutionDepartmentBody,
  UpdateMyInstitutionDepartmentBody,
  UpdateMyInstitutionDepartmentParams,
  CreateMyInstitutionFacilityBody,
  UpdateMyInstitutionFacilityBody,
  UpdateMyInstitutionFacilityParams,
} from "@workspace/api-zod";
import { getCandidateIdsForInstitution } from "../lib/candidate-institutions";
import {
  requireAdmin,
  requireAuth,
  isOrgOwner,
} from "../middleware/require-auth";
import { requirePermission } from "../lib/permissions";
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
    name: d.name,
    code: d.code,
    headName: d.headName,
    description: d.description,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
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

  const [departments, facilities] = await Promise.all([
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
  ]);

  res.json({
    ...serializeInstitution(institution, stats.studentCount, stats.placementRate),
    description: institution.description,
    partnerEmployers,
    departments: departments.map(serializeDepartment),
    facilities: facilities.map(serializeFacility),
  });
});

router.get("/institutions/:id/students", async (req, res): Promise<void> => {
  const params = ListInstitutionStudentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const studentIds = await getCandidateIdsForInstitution(params.data.id);

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
  // this institution has VERIFIED them as a real student.
  const linkRows = await db
    .select({
      candidateId: candidateInstitutionsTable.candidateId,
      isPrimary: candidateInstitutionsTable.isPrimary,
      verifiedAt: candidateInstitutionsTable.verifiedAt,
      verifiedByName: usersTable.fullName,
    })
    .from(candidateInstitutionsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, candidateInstitutionsTable.verifiedBy),
    )
    .where(
      and(
        eq(candidateInstitutionsTable.institutionId, params.data.id),
        inArray(candidateInstitutionsTable.candidateId, studentIds),
      ),
    );
  const linkInfoByCandidate = new Map<
    number,
    { isPrimary: boolean; isVerified: boolean; verifiedAt: string | null; verifiedByName: string | null }
  >(
    linkRows.map((r) => [
      r.candidateId,
      {
        isPrimary: r.isPrimary,
        isVerified: r.verifiedAt != null,
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        verifiedByName: r.verifiedByName,
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
      };
    }),
  );
});

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
  // Viewers can't change verification status — only owners and coordinators.
  return user.orgRole === "owner" || user.orgRole === "coordinator";
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
    if (!isOrgOwner(me)) {
      res.status(403).json({ error: "Owner access required" });
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
    if (!isOrgOwner(me)) {
      res.status(403).json({ error: "Owner access required" });
      return;
    }
    const parsed = CreateMyInstitutionDepartmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const [created] = await db
        .insert(institutionDepartmentsTable)
        .values({
          institutionId,
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
    if (!isOrgOwner(me)) {
      res.status(403).json({ error: "Owner access required" });
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
    if (!isOrgOwner(me)) {
      res.status(403).json({ error: "Owner access required" });
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
    if (!isOrgOwner(me)) {
      res.status(403).json({ error: "Owner access required" });
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
    if (!isOrgOwner(me)) {
      res.status(403).json({ error: "Owner access required" });
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
    if (!isOrgOwner(me)) {
      res.status(403).json({ error: "Owner access required" });
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
