import { Router, type IRouter } from "express";
import { eq, inArray, sql, desc, and } from "drizzle-orm";
import {
  db,
  institutionsTable,
  candidatesTable,
  candidateInstitutionsTable,
  applicationsTable,
  jobsTable,
  employersTable,
} from "@workspace/db";
import {
  CreateInstitutionBody,
  GetInstitutionParams,
  ListInstitutionStudentsParams,
} from "@workspace/api-zod";
import { getCandidateIdsForInstitution } from "../lib/candidate-institutions";
import { requireAdmin, requireAuth } from "../middleware/require-auth";
import { usersTable } from "@workspace/db";

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

  res.json({
    ...serializeInstitution(institution, stats.studentCount, stats.placementRate),
    description: institution.description,
    partnerEmployers,
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
    res.json({ ok: true, verifiedAt: result[0]!.verifiedAt!.toISOString() });
  },
);

router.post(
  "/institutions/:id/students/:candidateId/unverify",
  requireAuth,
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
    res.json({ ok: true });
  },
);

export default router;
