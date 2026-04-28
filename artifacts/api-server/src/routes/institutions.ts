import { Router, type IRouter } from "express";
import { eq, sql, desc, and } from "drizzle-orm";
import {
  db,
  institutionsTable,
  candidatesTable,
  applicationsTable,
  jobsTable,
  employersTable,
} from "@workspace/db";
import {
  CreateInstitutionBody,
  GetInstitutionParams,
  ListInstitutionStudentsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getInstitutionStats(institutionId: number) {
  const students = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.institutionId, institutionId));

  if (students.length === 0) {
    return { studentCount: 0, placementRate: 0 };
  }

  const studentIds = students.map((s) => s.id);
  const hires = await db
    .select({ candidateId: applicationsTable.candidateId })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.status, "hired"),
        sql`${applicationsTable.candidateId} IN (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})`,
      ),
    );

  const placedIds = new Set(hires.map((h) => h.candidateId));
  return {
    studentCount: students.length,
    placementRate: placedIds.size / students.length,
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

  const result = await Promise.all(
    all.map(async (i) => {
      const stats = await getInstitutionStats(i.id);
      return serializeInstitution(i, stats.studentCount, stats.placementRate);
    }),
  );

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

  // Top employers that hired students from this institution
  const hires = await db
    .select({
      employer: employersTable,
    })
    .from(applicationsTable)
    .innerJoin(candidatesTable, eq(candidatesTable.id, applicationsTable.candidateId))
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(
      and(
        eq(candidatesTable.institutionId, institution.id),
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

  const students = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.institutionId, params.data.id))
    .orderBy(desc(candidatesTable.talentScore));

  if (students.length === 0) {
    res.json([]);
    return;
  }

  const studentIds = students.map((s) => s.id);

  const apps = await db
    .select({
      candidateId: applicationsTable.candidateId,
      status: applicationsTable.status,
      employerName: employersTable.name,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(
      sql`${applicationsTable.candidateId} IN (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})`,
    );

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
      };
    }),
  );
});

export default router;
