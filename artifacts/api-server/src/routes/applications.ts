import { Router, type IRouter } from "express";
import { z } from "zod";
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
  jobChallengesTable,
  applicationChallengesTable,
  alumniIntroRequestsTable,
  usersTable,
} from "@workspace/db";
import { sendNotification, sendNotificationToCandidate } from "../lib/notifier";
import { candidateInstitutionsTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
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

/**
 * Single-application path equivalent of the bulk `introByPair`
 * lookup. Only callers that already gated on viewerRole=employer|admin
 * should use this — server still returns rows but the caller filters.
 */
async function getIntroEndorsementsForApplication(
  candidateId: number,
  jobId: number,
): Promise<
  Array<{
    alumniUserId: number;
    alumniName: string;
    alumniAvatarUrl: string | null;
    response: string | null;
    respondedAt: string;
  }>
> {
  const rows = await db
    .select({
      alumniUserId: alumniIntroRequestsTable.alumniUserId,
      response: alumniIntroRequestsTable.response,
      respondedAt: alumniIntroRequestsTable.respondedAt,
      alumniName: usersTable.fullName,
      alumniAvatarUrl: candidatesTable.avatarUrl,
    })
    .from(alumniIntroRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, alumniIntroRequestsTable.alumniUserId))
    .leftJoin(candidatesTable, eq(candidatesTable.id, usersTable.candidateId))
    .where(
      and(
        eq(alumniIntroRequestsTable.status, "accepted"),
        eq(alumniIntroRequestsTable.candidateId, candidateId),
        eq(alumniIntroRequestsTable.jobId, jobId),
      ),
    );
  return rows.map((r) => ({
    alumniUserId: r.alumniUserId,
    alumniName: r.alumniName,
    alumniAvatarUrl: r.alumniAvatarUrl ?? null,
    response: r.response,
    respondedAt: r.respondedAt
      ? r.respondedAt.toISOString()
      : new Date(0).toISOString(),
  }));
}

async function serializeApplication(
  applicationId: number,
  viewerRole: "candidate" | "employer" | "institution" | "admin",
) {
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
    introEndorsements:
      viewerRole === "employer" || viewerRole === "admin"
        ? await getIntroEndorsementsForApplication(row.candidate.id, row.job.id)
        : [],
    // See list-endpoint comment: only the candidate and admins see
    // the raw reported number; employers/institutions get nulls so
    // the per-row offer is never leaked across the tenant boundary.
    reportedSalary:
      viewerRole === "candidate" || viewerRole === "admin"
        ? row.application.reportedSalary
        : null,
    reportedCurrency:
      viewerRole === "candidate" || viewerRole === "admin"
        ? row.application.reportedCurrency
        : null,
    salaryReportedAt:
      (viewerRole === "candidate" || viewerRole === "admin") &&
      row.application.salaryReportedAt
        ? row.application.salaryReportedAt.toISOString()
        : null,
    ...(await getChallengeSummary(row.application.id, viewerRole)),
  };
}

async function getChallengeSummary(
  applicationId: number,
  viewerRole: "candidate" | "employer" | "institution" | "admin",
): Promise<{
  challengeScore: number | null;
  challengeBreakdown: unknown[] | null;
}> {
  const [row] = await db
    .select({
      score: applicationChallengesTable.score,
      breakdown: applicationChallengesTable.breakdown,
    })
    .from(applicationChallengesTable)
    .where(eq(applicationChallengesTable.applicationId, applicationId))
    .limit(1);
  if (!row) return { challengeScore: null, challengeBreakdown: null };
  return {
    challengeScore: row.score,
    challengeBreakdown: sanitizeBreakdownForViewer(row.breakdown, viewerRole),
  };
}

/**
 * The stored breakdown includes the `correct` answer-key index for
 * each question (so employers can review which questions a candidate
 * got wrong). That field is an answer key and must never be returned
 * to a candidate — it would let them share keys for live challenges.
 * Employers and admins see the full breakdown; everyone else sees
 * only the score (null breakdown).
 */
function sanitizeBreakdownForViewer(
  raw: unknown,
  viewerRole: "candidate" | "employer" | "institution" | "admin",
): unknown[] | null {
  if (!Array.isArray(raw)) return null;
  if (viewerRole === "employer" || viewerRole === "admin") {
    return raw as unknown[];
  }
  // Strip `correct` for any non-employer viewer (candidate /
  // institution). isCorrect is fine to keep — it tells the
  // candidate whether they got each one right without revealing
  // the key.
  return raw.map((item) => {
    if (!item || typeof item !== "object") return item;
    const { correct: _correct, ...rest } = item as Record<string, unknown>;
    return rest;
  });
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

  // Bulk-fetch accepted alumni intro endorsements for these
  // (candidate, job) pairs. Surfaced on the Kanban for employer/admin
  // viewers only.
  const introByPair = new Map<
    string,
    Array<{
      alumniUserId: number;
      alumniName: string;
      alumniAvatarUrl: string | null;
      response: string | null;
      respondedAt: string;
    }>
  >();
  if (rows.length > 0 && (user.role === "employer" || user.role === "admin")) {
    const candidateIds = Array.from(new Set(rows.map((r) => r.candidate.id)));
    const jobIds = Array.from(new Set(rows.map((r) => r.job.id)));
    const introRows = await db
      .select({
        candidateId: alumniIntroRequestsTable.candidateId,
        jobId: alumniIntroRequestsTable.jobId,
        alumniUserId: alumniIntroRequestsTable.alumniUserId,
        response: alumniIntroRequestsTable.response,
        respondedAt: alumniIntroRequestsTable.respondedAt,
        alumniName: usersTable.fullName,
        alumniAvatarUrl: candidatesTable.avatarUrl,
      })
      .from(alumniIntroRequestsTable)
      .innerJoin(usersTable, eq(usersTable.id, alumniIntroRequestsTable.alumniUserId))
      .leftJoin(
        candidatesTable,
        eq(candidatesTable.id, usersTable.candidateId),
      )
      .where(
        and(
          eq(alumniIntroRequestsTable.status, "accepted"),
          inArray(alumniIntroRequestsTable.candidateId, candidateIds),
          inArray(alumniIntroRequestsTable.jobId, jobIds),
        ),
      );
    for (const r of introRows) {
      const k = `${r.candidateId}:${r.jobId}`;
      const arr = introByPair.get(k) ?? [];
      arr.push({
        alumniUserId: r.alumniUserId,
        alumniName: r.alumniName,
        alumniAvatarUrl: r.alumniAvatarUrl ?? null,
        response: r.response,
        respondedAt: r.respondedAt
          ? r.respondedAt.toISOString()
          : new Date(0).toISOString(),
      });
      introByPair.set(k, arr);
    }
  }

  // Bulk-fetch challenge scores + breakdowns for the same applications
  // so the employer Kanban renders the badge and the per-question
  // breakdown without N+1.
  const challengeByApp = new Map<
    number,
    { score: number; breakdown: unknown[] }
  >();
  if (rows.length > 0) {
    const appIds = rows.map((r) => r.application.id);
    const subs = await db
      .select({
        applicationId: applicationChallengesTable.applicationId,
        score: applicationChallengesTable.score,
        breakdown: applicationChallengesTable.breakdown,
      })
      .from(applicationChallengesTable)
      .where(inArray(applicationChallengesTable.applicationId, appIds));
    for (const s of subs) {
      if (s.applicationId != null) {
        challengeByApp.set(s.applicationId, {
          score: s.score,
          breakdown: Array.isArray(s.breakdown) ? (s.breakdown as unknown[]) : [],
        });
      }
    }
  }

  const result = rows.map((row) => {
    const mock = mockByPair.get(`${row.candidate.id}:${row.job.id}`) ?? null;
    const endorsement = endorseByApp.get(row.application.id) ?? null;
    const challengeEntry = challengeByApp.get(row.application.id) ?? null;
    const challengeScore = challengeEntry?.score ?? null;
    const challengeBreakdown = challengeEntry
      ? sanitizeBreakdownForViewer(
          challengeEntry.breakdown,
          user.role as "candidate" | "employer" | "institution" | "admin",
        )
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
      introEndorsements:
        user.role === "employer" || user.role === "admin"
          ? introByPair.get(`${row.candidate.id}:${row.job.id}`) ?? []
          : [],
      // Reported salary is private feedback from the candidate that
      // only feeds the aggregate /salary-insights band. We expose the
      // raw value only to the candidate themselves (and admins) so the
      // UI can show "Reported" instead of the prompt — employers and
      // institutions never see individual numbers.
      reportedSalary:
        user.role === "candidate" || user.role === "admin"
          ? row.application.reportedSalary
          : null,
      reportedCurrency:
        user.role === "candidate" || user.role === "admin"
          ? row.application.reportedCurrency
          : null,
      salaryReportedAt:
        (user.role === "candidate" || user.role === "admin") &&
        row.application.salaryReportedAt
          ? row.application.salaryReportedAt.toISOString()
          : null,
      challengeScore,
      challengeBreakdown,
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

  // Challenge gate: if this job has a skill challenge attached, the
  // candidate MUST submit the challenge first (via POST
  // /jobs/:id/challenge/submit, which creates the application
  // atomically). A direct POST /applications without a submission
  // is rejected so cover-note-only applies can't bypass the gate.
  const [jobChallenge] = await db
    .select({ id: jobChallengesTable.id })
    .from(jobChallengesTable)
    .where(eq(jobChallengesTable.jobId, parsed.data.jobId));
  if (jobChallenge) {
    const [submission] = await db
      .select({ id: applicationChallengesTable.id })
      .from(applicationChallengesTable)
      .where(
        and(
          eq(applicationChallengesTable.candidateId, parsed.data.candidateId),
          eq(applicationChallengesTable.jobId, parsed.data.jobId),
        ),
      );
    if (!submission) {
      res.status(409).json({
        error:
          "This job requires a skill challenge. Submit it via /jobs/:id/challenge/submit first.",
        requiresChallenge: true,
      });
      return;
    }
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
    const serialized = await serializeApplication(
      existing.id,
      user.role as "candidate" | "employer" | "institution" | "admin",
    );
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

  const serialized = await serializeApplication(
    created.id,
    user.role as "candidate" | "employer" | "institution" | "admin",
  );
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

    // T6: when a candidate transitions to `hired`, fan-out an in-app
    // notification to every owner/registrar of each institution that
    // has verified this candidate. Best-effort; failures are logged
    // and never block the status update. Email/Slack out of scope —
    // TODO(resend): once the Resend integration lands, also send a
    // weekly digest summarising hires per institution.
    if (parsed.data.status === "hired") {
      try {
        await notifyInstitutionsOfHire(updated.id, prev.candidateId, req.log);
      } catch (err) {
        req.log.warn({ err }, "Failed to fan-out hire notification to institutions");
      }
    }
  }

  const serialized = await serializeApplication(
    updated.id,
    user.role as "candidate" | "employer" | "institution" | "admin",
  );
  res.json(serialized);
});

/**
 * Candidate-only endpoint to optionally and anonymously report their
 * accepted salary AFTER an application transitions to `hired`. Feeds
 * the GET /salary-insights aggregate band — never echoed back per-row
 * to other viewers (no leakage of individual offers). Idempotent:
 * resubmitting overwrites the previous value.
 */
router.post(
  "/applications/:id/report-salary",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "candidate") {
      res
        .status(403)
        .json({ error: "Only candidates may report their own salary" });
      return;
    }

    const params = UpdateApplicationStatusParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const Body = z.object({
      reportedSalary: z.number().int().positive().max(100_000_000),
      reportedCurrency: z.string().min(2).max(8),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({
        candidateId: applicationsTable.candidateId,
        status: applicationsTable.status,
      })
      .from(applicationsTable)
      .where(eq(applicationsTable.id, params.data.id));

    if (!existing) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    if (existing.candidateId !== user.candidateId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (existing.status !== "hired") {
      res
        .status(409)
        .json({ error: "Salary can only be reported on hired applications" });
      return;
    }

    await db
      .update(applicationsTable)
      .set({
        reportedSalary: parsed.data.reportedSalary,
        reportedCurrency: parsed.data.reportedCurrency.toUpperCase(),
        salaryReportedAt: new Date(),
      })
      .where(eq(applicationsTable.id, params.data.id));

    res.status(200).json({ ok: true });
  },
);

/**
 * T6: For each verified institution that this candidate is affiliated
 * with, push an in-app notification to every owner/registrar of that
 * org. These are the only org roles with both placement-tracking
 * responsibility and dashboard access, so they're the right audience
 * for "your student got hired".
 *
 * Looks up the candidate's name and the hiring employer + job title
 * once, then dispatches one notification per (institution, owner-or-
 * registrar) pair via the standard `sendNotification` helper so
 * existing push/preferences plumbing is preserved.
 */
async function notifyInstitutionsOfHire(
  applicationId: number,
  candidateId: number,
  log: { warn: (...args: unknown[]) => void },
): Promise<void> {
  // 1) Verified institutions for this candidate.
  const verifiedLinks = await db
    .select({ institutionId: candidateInstitutionsTable.institutionId })
    .from(candidateInstitutionsTable)
    .where(
      and(
        eq(candidateInstitutionsTable.candidateId, candidateId),
        isNotNull(candidateInstitutionsTable.verifiedAt),
      ),
    );
  if (verifiedLinks.length === 0) return;
  const institutionIds = Array.from(
    new Set(verifiedLinks.map((l) => l.institutionId)),
  );

  // 2) Candidate name + hiring context for the notification copy.
  const [ctx] = await db
    .select({
      candidateName: candidatesTable.fullName,
      jobTitle: jobsTable.title,
      employerName: employersTable.name,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .innerJoin(candidatesTable, eq(candidatesTable.id, applicationsTable.candidateId))
    .where(eq(applicationsTable.id, applicationId))
    .limit(1);
  if (!ctx) {
    log.warn({ applicationId }, "notifyInstitutionsOfHire: missing context");
    return;
  }

  // 3) Owners + registrars of each verified institution.
  const recipients = await db
    .select({
      userId: usersTable.id,
      institutionId: usersTable.institutionId,
      institutionName: institutionsTable.name,
    })
    .from(usersTable)
    .innerJoin(
      institutionsTable,
      eq(institutionsTable.id, usersTable.institutionId),
    )
    .where(
      and(
        eq(usersTable.role, "institution"),
        inArray(usersTable.institutionId, institutionIds),
        inArray(usersTable.orgRole, ["owner", "registrar"]),
      ),
    );
  if (recipients.length === 0) return;

  await Promise.all(
    recipients.map((r) =>
      sendNotification({
        userId: r.userId,
        kind: "institution_student_hired",
        title: `${ctx.candidateName} was hired`,
        body: `${ctx.candidateName} accepted a ${ctx.jobTitle} role at ${ctx.employerName}.`,
        link: `/dashboard/institution/analytics`,
        category: "applicationStatus",
        data: {
          applicationId,
          candidateId,
          institutionId: r.institutionId,
        },
      }),
    ),
  );
}

export default router;
