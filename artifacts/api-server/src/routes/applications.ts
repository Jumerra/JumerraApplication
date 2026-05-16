import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  applicationsTable,
  applicationStatusHistoryTable,
  jobsTable,
  candidatesTable,
  employersTable,
} from "@workspace/db";
import { sendNotificationToCandidate } from "../lib/notifier";
import {
  ListApplicationsQueryParams,
  CreateApplicationBody,
  UpdateApplicationStatusParams,
  UpdateApplicationStatusBody,
} from "@workspace/api-zod";
import { calculateMatchScore } from "../lib/matching";
import { requireAuth } from "../middleware/require-auth";
import { requirePermission } from "../lib/permissions";

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
    boardOrder: row.application.boardOrder,
    source: row.application.source,
    appliedAt: row.application.appliedAt.toISOString(),
    updatedAt: row.application.updatedAt.toISOString(),
  };
}

router.get("/applications", requireAuth, async (req, res): Promise<void> => {
  const params = ListApplicationsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const user = req.currentUser!;
  const conditions = [];

  // Server-side tenant scoping. Never trust client-supplied
  // candidateId/employerId for authorization — they may only narrow
  // results within the caller's own scope.
  if (user.role === "candidate") {
    if (!user.candidateId) {
      res.json([]);
      return;
    }
    conditions.push(eq(applicationsTable.candidateId, user.candidateId));
  } else if (user.role === "employer") {
    if (!user.employerId) {
      res.json([]);
      return;
    }
    conditions.push(eq(jobsTable.employerId, user.employerId));
  } else if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Optional client-supplied narrowing — only applied if compatible
  // with the caller's scope (admin can use any; employer/candidate are
  // already constrained above so further filters are safe).
  if (params.data.candidateId) {
    if (user.role === "candidate" && params.data.candidateId !== user.candidateId) {
      res.json([]);
      return;
    }
    conditions.push(eq(applicationsTable.candidateId, params.data.candidateId));
  }
  if (params.data.employerId) {
    if (user.role === "employer" && params.data.employerId !== user.employerId) {
      res.json([]);
      return;
    }
    conditions.push(eq(jobsTable.employerId, params.data.employerId));
  }
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

  const result = rows.map((row) => ({
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
    boardOrder: row.application.boardOrder,
    source: row.application.source,
    appliedAt: row.application.appliedAt.toISOString(),
    updatedAt: row.application.updatedAt.toISOString(),
  }));

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
      // `source` is optional in the OpenAPI contract and defaults to
      // "browse" both in the Zod schema and the DB column, so passing
      // the parsed value here is always safe.
      source: parsed.data.source ?? "browse",
      status: "applied",
      matchScore: score,
    })
    .returning();

  // Seed the timeline with the initial "applied" milestone so the
  // candidate-side timeline view always has at least one row of
  // history for any application created post-engagement-loops.
  await db.insert(applicationStatusHistoryTable).values({
    applicationId: created.id,
    status: "applied",
    changedBy: req.currentUser?.id ?? null,
  });

  const serialized = await serializeApplication(created.id);
  res.status(201).json(serialized);
});

router.patch(
  "/applications/:id",
  requireAuth,
  requirePermission("applications:respond"),
  async (req, res): Promise<void> => {
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

  // Look up the previous status so we only insert a history row + send
  // a notification when something actually changed.
  const [prev] = await db
    .select({ status: applicationsTable.status, candidateId: applicationsTable.candidateId })
    .from(applicationsTable)
    .where(eq(applicationsTable.id, params.data.id));

  const setPatch: { status?: string; boardOrder?: number } = {};
  if (parsed.data.status !== undefined) setPatch.status = parsed.data.status;
  if (parsed.data.boardOrder !== undefined)
    setPatch.boardOrder = parsed.data.boardOrder;
  if (Object.keys(setPatch).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(applicationsTable)
    .set(setPatch)
    .where(eq(applicationsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  if (prev && parsed.data.status && prev.status !== parsed.data.status) {
    await db.insert(applicationStatusHistoryTable).values({
      applicationId: updated.id,
      status: parsed.data.status,
      changedBy: user.id,
    });
    // Notify the candidate (best-effort; never block the response).
    try {
      await sendNotificationToCandidate(prev.candidateId, {
        kind: "application_status_changed",
        title: `Your application moved to ${parsed.data.status}`,
        body: "Tap to see the next step in your timeline.",
        link: `/account/applications/${updated.id}`,
        category: "applicationStatus",
        data: { applicationId: updated.id, status: parsed.data.status },
      });
    } catch (err) {
      req.log.warn({ err }, "Failed to enqueue status-change notification");
    }
  }

  const serialized = await serializeApplication(updated.id);
  res.json(serialized);
});

export default router;
