import { Router, type IRouter } from "express";
import { eq, sql, desc, and } from "drizzle-orm";
import {
  db,
  jobsTable,
  employersTable,
  applicationsTable,
  candidatesTable,
} from "@workspace/db";
import {
  ListJobsQueryParams,
  CreateJobBody,
  GetJobParams,
  GetJobMatchesParams,
} from "@workspace/api-zod";
import { calculateMatchScore } from "../lib/matching";
import { requireAuth } from "../middleware/require-auth";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();

function serializeJob(
  j: typeof jobsTable.$inferSelect,
  employer: { name: string; logoUrl: string },
  applicationsCount: number,
) {
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

router.get("/jobs", async (req, res): Promise<void> => {
  const params = ListJobsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db
    .select({
      job: jobsTable,
      employer: employersTable,
      applicationsCount: sql<number>`coalesce((SELECT count(*)::int FROM ${applicationsTable} WHERE ${applicationsTable.jobId} = ${jobsTable.id}), 0)`,
    })
    .from(jobsTable)
    .innerJoin(employersTable, eq(jobsTable.employerId, employersTable.id))
    .orderBy(desc(jobsTable.featured), desc(jobsTable.postedAt));

  const filters = params.data;
  const filtered = rows.filter(({ job }) => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const blob = `${job.title} ${job.summary} ${job.skills.join(" ")}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (filters.type && job.type !== filters.type) return false;
    if (filters.location && !job.location.toLowerCase().includes(filters.location.toLowerCase())) return false;
    if (filters.remote !== undefined && job.remote !== filters.remote) return false;
    if (filters.employerId && job.employerId !== filters.employerId) return false;
    if (filters.featured !== undefined && job.featured !== filters.featured) return false;
    if (filters.skill) {
      const skillLower = filters.skill.toLowerCase();
      if (!job.skills.some((s) => s.toLowerCase() === skillLower)) return false;
    }
    return true;
  });

  res.json(
    filtered.map(({ job, employer, applicationsCount }) =>
      serializeJob(job, employer, Number(applicationsCount)),
    ),
  );
});

router.post(
  "/jobs",
  requireAuth,
  requirePermission("jobs:manage"),
  async (req, res): Promise<void> => {
  const user = req.currentUser!;

  if (user.role !== "employer" && user.role !== "admin") {
    res.status(403).json({ error: "Only employers or admins may post jobs" });
    return;
  }

  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const employerId =
    user.role === "admin" ? parsed.data.employerId : user.employerId;

  if (!employerId) {
    res.status(403).json({ error: "No employer account linked to this user" });
    return;
  }

  const [created] = await db
    .insert(jobsTable)
    .values({
      ...parsed.data,
      employerId,
      featured: parsed.data.featured ?? false,
    })
    .returning();

  const [employer] = await db
    .select({ name: employersTable.name, logoUrl: employersTable.logoUrl })
    .from(employersTable)
    .where(eq(employersTable.id, created.employerId));

  res.status(201).json(serializeJob(created, employer ?? { name: "", logoUrl: "" }, 0));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select({
      job: jobsTable,
      employer: employersTable,
      applicationsCount: sql<number>`coalesce((SELECT count(*)::int FROM ${applicationsTable} WHERE ${applicationsTable.jobId} = ${jobsTable.id}), 0)`,
    })
    .from(jobsTable)
    .innerJoin(employersTable, eq(jobsTable.employerId, employersTable.id))
    .where(eq(jobsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json({
    ...serializeJob(row.job, row.employer, Number(row.applicationsCount)),
    description: row.job.description,
    responsibilities: row.job.responsibilities,
    requirements: row.job.requirements,
    benefits: row.job.benefits,
  });
});

router.get("/jobs/:id/matches", requireAuth, async (req, res): Promise<void> => {
  const params = GetJobMatchesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const candidates = await db.select().from(candidatesTable);

  const ranked = candidates
    .map((c) => {
      const { score, matchedSkills } = calculateMatchScore(
        job.skills,
        c.skills,
        c.yearsExperience,
        c.talentScore,
      );
      return {
        candidateId: c.id,
        fullName: c.fullName,
        avatarUrl: c.avatarUrl,
        headline: c.headline,
        location: c.location,
        talentScore: c.talentScore,
        matchScore: score,
        matchedSkills,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 12);

  res.json(ranked);
});

export default router;
