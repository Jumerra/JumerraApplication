import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  applicationsTable,
  applicationStatusHistoryTable,
  applicationEndorsementsTable,
  jobsTable,
  candidatesTable,
  employersTable,
  institutionsTable,
  mockInterviewsTable,
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

/**
 * Look up the most recent finalised mock interview for (candidate,
 * job) and return its sub-scores. Used by both serializeApplication
 * (employer view) and the linker that runs on POST /applications.
 */
async function findLatestFinalisedMockInterview(
  candidateId: number,
  jobId: number,
): Promise<{
  id: number;
  scoreOverall: number;
  scoreTechnical: number;
  scoreCommunication: number;
  scoreCulture: number;
} | null> {
  const [row] = await db
    .select({
      id: mockInterviewsTable.id,
      scoreOverall: mockInterviewsTable.scoreOverall,
      scoreTechnical: mockInterviewsTable.scoreTechnical,
      scoreCommunication: mockInterviewsTable.scoreCommunication,
      scoreCulture: mockInterviewsTable.scoreCulture,
    })
    .from(mockInterviewsTable)
    .where(
      and(
        eq(mockInterviewsTable.candidateId, candidateId),
        eq(mockInterviewsTable.jobId, jobId),
        eq(mockInterviewsTable.status, "finalised"),
      ),
    )
    .orderBy(desc(mockInterviewsTable.completedAt))
    .limit(1);
  if (
    !row ||
    row.scoreOverall == null ||
    row.scoreTechnical == null ||
    row.scoreCommunication == null ||
    row.scoreCulture == null
  ) {
    return null;
  }
  return {
    id: row.id,
    scoreOverall: row.scoreOverall,
    scoreTechnical: row.scoreTechnical,
    scoreCommunication: row.scoreCommunication,
    scoreCulture: row.scoreCulture,
  };
}

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
  const mock = await findLatestFinalisedMockInterview(
    row.candidate.id,
    row.job.id,
  );
  const [endorseRow] = await db
    .select({
      institutionId: applicationEndorsementsTable.institutionId,
      institutionName: institutionsTable.name,
      note: applicationEndorsementsTable.note,
      createdAt: applicationEndorsementsTable.createdAt,
    })
    .from(applicationEndorsementsTable)
    .innerJoin(
      institutionsTable,
      eq(institutionsTable.id, applicationEndorsementsTable.institutionId),
    )
    .where(eq(applicationEndorsementsTable.applicationId, row.application.id))
    .limit(1);
  const endorsement = endorseRow
    ? {
        institutionId: endorseRow.institutionId,
        institutionName: endorseRow.institutionName,
        note: endorseRow.note,
        endorsedAt: endorseRow.createdAt.toISOString(),
      }
    : null;
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
    mockInterviewId: mock?.id ?? null,
    mockInterviewScore: mock?.scoreOverall ?? null,
    mockInterviewBreakdown: mock
      ? {
          technical: mock.scoreTechnical,
          communication: mock.scoreCommunication,
          culture: mock.scoreCulture,
        }
      : null,
    endorsement,
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

  // Bulk-fetch the latest finalised mock interview for every
  // (candidate, job) pair in one query so the Kanban / dashboard
  // list calls don't N+1 against mock_interviews.
  const mockByPair = new Map<
    string,
    {
      id: number;
      scoreOverall: number;
      scoreTechnical: number;
      scoreCommunication: number;
      scoreCulture: number;
    }
  >();
  if (rows.length > 0) {
    const pairKeys = rows.map(
      (r) => `${r.candidate.id}:${r.job.id}` as const,
    );
    const candidateIds = Array.from(new Set(rows.map((r) => r.candidate.id)));
    const jobIds = Array.from(new Set(rows.map((r) => r.job.id)));
    const mocks = await db
      .select({
        id: mockInterviewsTable.id,
        candidateId: mockInterviewsTable.candidateId,
        jobId: mockInterviewsTable.jobId,
        scoreOverall: mockInterviewsTable.scoreOverall,
        scoreTechnical: mockInterviewsTable.scoreTechnical,
        scoreCommunication: mockInterviewsTable.scoreCommunication,
        scoreCulture: mockInterviewsTable.scoreCulture,
        completedAt: mockInterviewsTable.completedAt,
      })
      .from(mockInterviewsTable)
      .where(
        and(
          eq(mockInterviewsTable.status, "finalised"),
          inArray(mockInterviewsTable.candidateId, candidateIds),
          inArray(mockInterviewsTable.jobId, jobIds),
        ),
      )
      .orderBy(desc(mockInterviewsTable.completedAt));
    const wantedKeys = new Set<string>(pairKeys);
    for (const m of mocks) {
      const key = `${m.candidateId}:${m.jobId}`;
      // ORDER BY desc + first-write-wins gives us the latest per pair
      if (!wantedKeys.has(key) || mockByPair.has(key)) continue;
      if (
        m.scoreOverall == null ||
        m.scoreTechnical == null ||
        m.scoreCommunication == null ||
        m.scoreCulture == null
      ) {
        continue;
      }
      mockByPair.set(key, {
        id: m.id,
        scoreOverall: m.scoreOverall,
        scoreTechnical: m.scoreTechnical,
        scoreCommunication: m.scoreCommunication,
        scoreCulture: m.scoreCulture,
      });
    }
  }

  // Bulk-fetch endorsements for the same applications so the
  // employer Kanban renders the "Verified by X" badge without N+1.
  const endorseByApp = new Map<
    number,
    {
      institutionId: number;
      institutionName: string;
      note: string | null;
      endorsedAt: string;
    }
  >();
  if (rows.length > 0) {
    const appIds = rows.map((r) => r.application.id);
    const endorseRows = await db
      .select({
        applicationId: applicationEndorsementsTable.applicationId,
        institutionId: applicationEndorsementsTable.institutionId,
        institutionName: institutionsTable.name,
        note: applicationEndorsementsTable.note,
        createdAt: applicationEndorsementsTable.createdAt,
      })
      .from(applicationEndorsementsTable)
      .innerJoin(
        institutionsTable,
        eq(institutionsTable.id, applicationEndorsementsTable.institutionId),
      )
      .where(inArray(applicationEndorsementsTable.applicationId, appIds));
    for (const e of endorseRows) {
      endorseByApp.set(e.applicationId, {
        institutionId: e.institutionId,
        institutionName: e.institutionName,
        note: e.note,
        endorsedAt: e.createdAt.toISOString(),
      });
    }
  }

  const result = rows.map((row) => {
    const mock = mockByPair.get(`${row.candidate.id}:${row.job.id}`) ?? null;
    const endorsement = endorseByApp.get(row.application.id) ?? null;
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
      mockInterviewId: mock?.id ?? null,
      mockInterviewScore: mock?.scoreOverall ?? null,
      mockInterviewBreakdown: mock
        ? {
            technical: mock.scoreTechnical,
            communication: mock.scoreCommunication,
            culture: mock.scoreCulture,
          }
        : null,
      endorsement,
    };
  });

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

  // Link the most recent finalised mock interview for this (candidate,
  // job) — the score appears next to the keyword match score in the
  // employer Kanban. Best-effort: never block application creation.
  try {
    const mock = await findLatestFinalisedMockInterview(
      parsed.data.candidateId,
      parsed.data.jobId,
    );
    if (mock) {
      await db
        .update(mockInterviewsTable)
        .set({ applicationId: created.id })
        .where(eq(mockInterviewsTable.id, mock.id));
    }
  } catch (err) {
    req.log.warn({ err }, "link mock interview to application failed");
  }

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
