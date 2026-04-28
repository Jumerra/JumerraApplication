import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  applicationsTable,
  jobsTable,
  candidatesTable,
  employersTable,
} from "@workspace/db";
import {
  ListApplicationsQueryParams,
  CreateApplicationBody,
  UpdateApplicationStatusParams,
  UpdateApplicationStatusBody,
} from "@workspace/api-zod";
import { calculateMatchScore } from "../lib/matching";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

async function serializeApplication(applicationId: number) {
  const [row] = await db
    .select({
      application: applicationsTable,
      job: jobsTable,
      candidate: candidatesTable,
      employer: employersTable,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(candidatesTable, eq(candidatesTable.id, applicationsTable.candidateId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(eq(applicationsTable.id, applicationId));

  if (!row) return null;
  return {
    id: row.application.id,
    jobId: row.job.id,
    jobTitle: row.job.title,
    candidateId: row.candidate.id,
    candidateName: row.candidate.fullName,
    candidateAvatarUrl: row.candidate.avatarUrl,
    employerId: row.employer.id,
    employerName: row.employer.name,
    employerLogoUrl: row.employer.logoUrl,
    status: row.application.status,
    matchScore: row.application.matchScore,
    coverNote: row.application.coverNote,
    appliedAt: row.application.appliedAt.toISOString(),
    updatedAt: row.application.updatedAt.toISOString(),
  };
}

router.get("/applications", async (req, res): Promise<void> => {
  const params = ListApplicationsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [];
  if (params.data.candidateId) conditions.push(eq(applicationsTable.candidateId, params.data.candidateId));
  if (params.data.jobId) conditions.push(eq(applicationsTable.jobId, params.data.jobId));
  if (params.data.status) conditions.push(eq(applicationsTable.status, params.data.status));

  const rows = await db
    .select({
      application: applicationsTable,
      job: jobsTable,
      candidate: candidatesTable,
      employer: employersTable,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(candidatesTable, eq(candidatesTable.id, applicationsTable.candidateId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(applicationsTable.appliedAt));

  let result = rows.map((row) => ({
    id: row.application.id,
    jobId: row.job.id,
    jobTitle: row.job.title,
    candidateId: row.candidate.id,
    candidateName: row.candidate.fullName,
    candidateAvatarUrl: row.candidate.avatarUrl,
    employerId: row.employer.id,
    employerName: row.employer.name,
    employerLogoUrl: row.employer.logoUrl,
    status: row.application.status,
    matchScore: row.application.matchScore,
    coverNote: row.application.coverNote,
    appliedAt: row.application.appliedAt.toISOString(),
    updatedAt: row.application.updatedAt.toISOString(),
  }));

  if (params.data.employerId) {
    result = result.filter((r) => r.employerId === params.data.employerId);
  }

  res.json(result);
});

router.post("/applications", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;

  if (user.role !== "candidate" && user.role !== "admin") {
    res.status(403).json({ error: "Only candidates may submit applications" });
    return;
  }

  const candidateId = user.role === "admin"
    ? (req.body?.candidateId as number | undefined)
    : user.candidateId;

  if (!candidateId) {
    res.status(403).json({ error: "No candidate profile linked to this account" });
    return;
  }

  const parsed = CreateApplicationBody.safeParse({ ...req.body, candidateId });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, parsed.data.jobId));
  const [candidate] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, parsed.data.candidateId));

  if (!job || !candidate) {
    res.status(404).json({ error: "Job or candidate not found" });
    return;
  }

  const { score } = calculateMatchScore(
    job.skills,
    candidate.skills,
    candidate.yearsExperience,
    candidate.talentScore,
  );

  // Prevent duplicate
  const [existing] = await db
    .select()
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.jobId, parsed.data.jobId),
        eq(applicationsTable.candidateId, parsed.data.candidateId),
      ),
    );

  if (existing) {
    const serialized = await serializeApplication(existing.id);
    res.status(200).json(serialized);
    return;
  }

  const [created] = await db
    .insert(applicationsTable)
    .values({
      jobId: parsed.data.jobId,
      candidateId: parsed.data.candidateId,
      coverNote: parsed.data.coverNote,
      status: "applied",
      matchScore: score,
    })
    .returning();

  const serialized = await serializeApplication(created.id);
  res.status(201).json(serialized);
});

router.patch("/applications/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;

  if (user.role !== "employer" && user.role !== "admin") {
    res.status(403).json({ error: "Only employers or admins may update application status" });
    return;
  }

  const params = UpdateApplicationStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateApplicationStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [row] = await db
    .select({ applicationId: applicationsTable.id, jobEmployerId: jobsTable.employerId })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .where(eq(applicationsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  if (user.role === "employer" && row.jobEmployerId !== user.employerId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [updated] = await db
    .update(applicationsTable)
    .set({ status: parsed.data.status })
    .where(eq(applicationsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  const serialized = await serializeApplication(updated.id);
  res.json(serialized);
});

export default router;
