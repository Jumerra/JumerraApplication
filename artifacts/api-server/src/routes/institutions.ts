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

const router: IRouter = Router();

async function getInstitutionStats(institutionId: number) {
  const studentIds = await getCandidateIdsForInstitution(institutionId);

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
) {
  return {
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
}

router.get("/institutions", async (_req, res): Promise<void> => {
  const all = await db.select().from(institutionsTable).orderBy(institutionsTable.name);

  if (all.length === 0) {
    res.json([]);
    return;
  }

  // Compute per-institution student count + placement rate in TWO queries
  // total (instead of 2*N) to avoid the obvious N+1 scaling cliff.
  const institutionIds = all.map((i) => i.id);

  const linkRows = await db
    .select({
      institutionId: candidateInstitutionsTable.institutionId,
      candidateId: candidateInstitutionsTable.candidateId,
    })
    .from(candidateInstitutionsTable)
    .where(inArray(candidateInstitutionsTable.institutionId, institutionIds));

  const studentsByInst = new Map<number, Set<number>>();
  const allStudentIds = new Set<number>();
  for (const r of linkRows) {
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
    return serializeInstitution(i, studentCount, placementRate);
  });

  res.json(result);
});

router.post("/institutions", async (req, res): Promise<void> => {
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
  // so the UI can flag transfer / multi-affiliation students.
  const linkRows = await db
    .select({
      candidateId: candidateInstitutionsTable.candidateId,
      isPrimary: candidateInstitutionsTable.isPrimary,
    })
    .from(candidateInstitutionsTable)
    .where(
      and(
        eq(candidateInstitutionsTable.institutionId, params.data.id),
        inArray(candidateInstitutionsTable.candidateId, studentIds),
      ),
    );
  const primaryByCandidate = new Map<number, boolean>(
    linkRows.map((r) => [r.candidateId, r.isPrimary]),
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
        isPrimaryAffiliation: primaryByCandidate.get(s.id) ?? false,
      };
    }),
  );
});

export default router;
