import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import {
  db,
  employersTable,
  jobsTable,
  applicationsTable,
} from "@workspace/db";
import {
  ListEmployersQueryParams,
  CreateEmployerBody,
  GetEmployerParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../middleware/require-auth";

const router: IRouter = Router();

function serializeEmployer(e: typeof employersTable.$inferSelect, openJobs: number) {
  return {
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
    openJobs,
    createdAt: e.createdAt.toISOString(),
  };
}

function serializeJob(j: typeof jobsTable.$inferSelect, employer: typeof employersTable.$inferSelect, applicationsCount: number) {
  return {
    id: j.id,
    title: j.title,
    employerId: j.employerId,
    employerName: employer.name,
    employerLogoUrl: employer.logoUrl,
    type: j.type,
    location: j.location,
    remote: j.remote,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    currency: j.currency,
    summary: j.summary,
    skills: j.skills,
    featured: j.featured,
    applicationsCount,
    postedAt: j.postedAt.toISOString(),
  };
}

router.get("/employers", async (req, res): Promise<void> => {
  const params = ListEmployersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db
    .select({
      employer: employersTable,
      openJobs: sql<number>`coalesce(count(${jobsTable.id})::int, 0)`,
    })
    .from(employersTable)
    .leftJoin(jobsTable, eq(jobsTable.employerId, employersTable.id))
    .groupBy(employersTable.id)
    .orderBy(desc(employersTable.verified), employersTable.name);

  let result = rows.map(({ employer, openJobs }) => serializeEmployer(employer, Number(openJobs)));

  if (params.data.search) {
    const q = params.data.search.toLowerCase();
    result = result.filter((e) => e.name.toLowerCase().includes(q) || e.industry.toLowerCase().includes(q));
  }

  res.json(result);
});

router.post("/employers", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateEmployerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [created] = await db.insert(employersTable).values(parsed.data).returning();
  res.status(201).json(serializeEmployer(created, 0));
});

router.get("/employers/:id", async (req, res): Promise<void> => {
  const params = GetEmployerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [employer] = await db
    .select()
    .from(employersTable)
    .where(eq(employersTable.id, params.data.id));

  if (!employer) {
    res.status(404).json({ error: "Employer not found" });
    return;
  }

  const jobs = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.employerId, params.data.id))
    .orderBy(desc(jobsTable.postedAt));

  const counts = await db
    .select({
      jobId: applicationsTable.jobId,
      count: sql<number>`count(*)::int`,
    })
    .from(applicationsTable)
    .where(
      sql`${applicationsTable.jobId} IN (${sql.join(jobs.map((j) => sql`${j.id}`), sql`, `)})`,
    )
    .groupBy(applicationsTable.jobId);
  const countMap = new Map(counts.map((c) => [c.jobId, Number(c.count)]));

  res.json({
    ...serializeEmployer(employer, jobs.length),
    jobs: jobs.map((j) => serializeJob(j, employer, countMap.get(j.id) ?? 0)),
  });
});

export default router;
