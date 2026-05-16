import { Router, type IRouter } from "express";
import { and, desc, eq, gt, ilike, sql } from "drizzle-orm";
import {
  db,
  applicationsTable,
  applicationStatusHistoryTable,
  candidatesTable,
  candidateSavedSearchesTable,
  candidateWeeklyDigestsTable,
  jobsTable,
  employersTable,
  candidateSkillVerificationsTable,
  profileViewsTable,
  type User,
} from "@workspace/db";
import {
  CreateSavedSearchBody,
  UpdateSavedSearchBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Candidates may only act on themselves; admins may act on anyone. */
function canActOnCandidate(user: User | undefined, candidateId: number): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role === "candidate" && user.candidateId === candidateId) return true;
  return false;
}

const STATUS_ORDER = [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
] as const;

const STATUS_LABEL: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

// Heuristic median ETA per current step. We don't have enough signal
// yet to infer this from history; once enough rows accumulate the
// digest worker will overwrite this with empirical medians.
const ETA_DAYS_BY_STATUS: Record<string, number> = {
  applied: 5,
  screening: 4,
  interview: 7,
  offer: 3,
};

// ---------------------------------------------------------------------------
// GET /candidates/:id/score-breakdown
// ---------------------------------------------------------------------------

router.get(
  "/candidates/:id/score-breakdown",
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params.id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }
    if (!canActOnCandidate(req.currentUser, candidateId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [candidate] = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, candidateId));
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }

    // -- Profile completeness (matches dashboard.ts formula) ---------------
    let profilePoints = 0;
    if (candidate.fullName) profilePoints += 10;
    if (candidate.headline) profilePoints += 10;
    if (candidate.bio && candidate.bio.length > 50) profilePoints += 15;
    if (candidate.avatarUrl) profilePoints += 10;
    if (candidate.location) profilePoints += 10;
    if (candidate.portfolioUrl) profilePoints += 10;
    if (candidate.videoIntroUrl) profilePoints += 10;
    const profileScore = Math.min(
      100,
      Math.round((profilePoints / 75) * 100),
    );

    // -- Skills ------------------------------------------------------------
    const skillsCount = candidate.skills.length;
    const skillsScore = Math.min(100, Math.round((skillsCount / 8) * 100));

    // -- Experience --------------------------------------------------------
    const experienceScore = Math.min(
      100,
      Math.round((candidate.yearsExperience / 5) * 100),
    );

    // -- Verifications -----------------------------------------------------
    const verifications = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(candidateSkillVerificationsTable)
      .where(
        and(
          eq(candidateSkillVerificationsTable.candidateId, candidateId),
          sql`${candidateSkillVerificationsTable.revokedAt} IS NULL`,
        ),
      );
    const verifiedCount = Number(verifications[0]?.count ?? 0);
    const verificationsScore = Math.min(
      100,
      Math.round((verifiedCount / 3) * 100),
    );

    // -- Application engagement -------------------------------------------
    const apps = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(applicationsTable)
      .where(eq(applicationsTable.candidateId, candidateId));
    const appCount = Number(apps[0]?.count ?? 0);
    const applicationsScore = Math.min(
      100,
      Math.round((appCount / 5) * 100),
    );

    const components = [
      { key: "profile", label: "Profile completeness", weight: 25, score: profileScore },
      { key: "skills", label: "Skills depth", weight: 25, score: skillsScore },
      { key: "experience", label: "Experience", weight: 20, score: experienceScore },
      { key: "verifications", label: "Verified badges", weight: 15, score: verificationsScore },
      { key: "applications", label: "Application activity", weight: 15, score: applicationsScore },
    ].map((c) => ({
      ...c,
      contribution: Math.round((c.weight * c.score) / 100),
    }));

    const overall = components.reduce((sum, c) => sum + c.contribution, 0);

    // -- Suggestions (ranked by remaining lift) ---------------------------
    const suggestions: Array<{
      key: string;
      title: string;
      description: string;
      impact: number;
      link: string;
    }> = [];
    if (profileScore < 100) {
      const missing: string[] = [];
      if (!candidate.bio || candidate.bio.length <= 50)
        missing.push("a richer bio");
      if (!candidate.avatarUrl) missing.push("a profile photo");
      if (!candidate.portfolioUrl) missing.push("a portfolio link");
      if (!candidate.videoIntroUrl) missing.push("a 30-second video intro");
      suggestions.push({
        key: "complete-profile",
        title: "Finish your profile",
        description: `Add ${missing.slice(0, 2).join(" and ") || "the remaining details"}.`,
        impact: Math.round(((100 - profileScore) * 25) / 100),
        link: "/account/profile",
      });
    }
    if (skillsCount < 8) {
      suggestions.push({
        key: "add-skills",
        title: `Add ${8 - skillsCount} more skill${8 - skillsCount === 1 ? "" : "s"}`,
        description:
          "Candidates with 8+ skills get matched to ~3× more roles.",
        impact: Math.round(((100 - skillsScore) * 25) / 100),
        link: "/account/profile",
      });
    }
    if (verifiedCount < 3) {
      suggestions.push({
        key: "request-verifications",
        title: "Get a skill verified",
        description:
          "Ask your school or past manager to verify a top skill — verified badges lift your match rank.",
        impact: Math.round(((100 - verificationsScore) * 15) / 100),
        link: "/account/profile",
      });
    }
    if (appCount < 5) {
      suggestions.push({
        key: "apply-more",
        title: "Apply to a few more roles",
        description:
          "5+ applications a month signal active engagement to employers.",
        impact: Math.round(((100 - applicationsScore) * 15) / 100),
        link: "/jobs",
      });
    }
    suggestions.sort((a, b) => b.impact - a.impact);

    res.json({
      score: overall,
      components,
      suggestions: suggestions.slice(0, 4),
    });
  },
);

// ---------------------------------------------------------------------------
// GET /candidates/:id/weekly-digest
// ---------------------------------------------------------------------------

router.get(
  "/candidates/:id/weekly-digest",
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params.id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }
    if (!canActOnCandidate(req.currentUser, candidateId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [row] = await db
      .select()
      .from(candidateWeeklyDigestsTable)
      .where(eq(candidateWeeklyDigestsTable.candidateId, candidateId))
      .orderBy(desc(candidateWeeklyDigestsTable.weekStart))
      .limit(1);

    if (!row) {
      res.json({ digest: null });
      return;
    }

    let matches: Array<{
      jobId: number;
      title: string;
      employerName: string;
      matchScore: number;
    }> = [];
    try {
      const parsed = JSON.parse(row.newMatchesJson);
      if (Array.isArray(parsed)) matches = parsed;
    } catch (err) {
      req.log.warn({ err, digestId: row.id }, "Bad newMatchesJson, ignoring");
    }

    res.json({
      digest: {
        weekStart:
          typeof row.weekStart === "string"
            ? row.weekStart
            : new Date(row.weekStart as unknown as string)
                .toISOString()
                .slice(0, 10),
        profileViews: row.profileViews,
        applicationsSent: row.applicationsSent,
        interviewsScheduled: row.interviewsScheduled,
        newMatches: matches,
        generatedAt: row.generatedAt.toISOString(),
      },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /applications/:id/timeline
// ---------------------------------------------------------------------------

router.get("/applications/:id/timeline", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid application id" });
    return;
  }

  const [row] = await db
    .select({
      app: applicationsTable,
      jobEmployerId: jobsTable.employerId,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .where(eq(applicationsTable.id, id));

  if (!row) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  // Authorization: this endpoint is part of the *candidate* engagement
  // loop — it surfaces the candidate-facing milestone narrative + ETA
  // copy ("typical employer response: 5 days"), not employer pipeline
  // data. Employers already see status through their own pipeline
  // routes, so we restrict this view to the candidate themself or an
  // admin. This matches threat-model "Information Disclosure" guidance:
  // workflow detail returned only to permitted viewers, scoped tightly.
  const me = req.currentUser;
  const allowed =
    me?.role === "admin" ||
    (me?.role === "candidate" && me.candidateId === row.app.candidateId);
  if (!allowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const history = await db
    .select()
    .from(applicationStatusHistoryTable)
    .where(eq(applicationStatusHistoryTable.applicationId, id))
    .orderBy(applicationStatusHistoryTable.changedAt);

  // Build a map status -> earliest reachedAt.
  const reachedAt = new Map<string, Date>();
  // Implicit "applied" milestone from appliedAt.
  reachedAt.set("applied", row.app.appliedAt);
  for (const h of history) {
    if (!reachedAt.has(h.status)) reachedAt.set(h.status, h.changedAt);
  }
  // Force the current status to be marked reached even if it preceded
  // the table's existence and never made it into history.
  if (!reachedAt.has(row.app.status)) {
    reachedAt.set(row.app.status, row.app.updatedAt);
  }

  const isTerminalRejected = row.app.status === "rejected";
  const isTerminalWithdrawn = row.app.status === "withdrawn";

  type Milestone = {
    status: string;
    label: string;
    reachedAt: string | null;
    isReached: boolean;
    isCurrent: boolean;
  };
  const milestones: Milestone[] = STATUS_ORDER.map((status) => {
    const at = reachedAt.get(status) ?? null;
    return {
      status,
      label: STATUS_LABEL[status] ?? status,
      reachedAt: at ? at.toISOString() : null,
      isReached: !!at,
      isCurrent: status === row.app.status,
    };
  });

  // Append a terminal rejected/withdrawn pseudo-milestone if applicable.
  if (isTerminalRejected || isTerminalWithdrawn) {
    const term = isTerminalRejected ? "rejected" : "withdrawn";
    milestones.push({
      status: term,
      label: STATUS_LABEL[term] ?? term,
      reachedAt:
        (reachedAt.get(term) ?? row.app.updatedAt).toISOString(),
      isReached: true,
      isCurrent: true,
    });
  }

  let etaDays: number | null = null;
  let etaLabel = "";
  if (isTerminalRejected || isTerminalWithdrawn) {
    etaLabel = "This application is closed.";
  } else if (row.app.status === "hired") {
    etaLabel = "You're hired — congratulations!";
  } else {
    const days = ETA_DAYS_BY_STATUS[row.app.status] ?? null;
    if (days != null) {
      etaDays = days;
      const since = reachedAt.get(row.app.status) ?? row.app.updatedAt;
      const elapsed = Math.floor(
        (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24),
      );
      const remaining = Math.max(0, days - elapsed);
      etaLabel =
        remaining === 0
          ? "Employer response is due any day now."
          : `Typical employer response: ${remaining} day${remaining === 1 ? "" : "s"}.`;
    } else {
      etaLabel = "Awaiting next step.";
    }
  }

  res.json({
    applicationId: id,
    currentStatus: row.app.status,
    milestones,
    etaDays,
    etaLabel,
  });
});

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

async function newMatchCount(
  searchText: string | null,
  jobType: string | null,
  lastSeenJobId: number,
): Promise<number> {
  const conds = [gt(jobsTable.id, lastSeenJobId)];
  if (jobType) conds.push(eq(jobsTable.type, jobType));
  if (searchText && searchText.trim()) {
    conds.push(ilike(jobsTable.title, `%${searchText.trim()}%`));
  }
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobsTable)
    .where(and(...conds));
  return Number(row?.count ?? 0);
}

function serializeSavedSearch(
  s: typeof candidateSavedSearchesTable.$inferSelect,
  newCount: number,
) {
  return {
    id: s.id,
    name: s.name,
    searchText: s.searchText,
    jobType: s.jobType,
    alertsEnabled: s.alertsEnabled,
    createdAt: s.createdAt.toISOString(),
    newMatchCount: newCount,
  };
}

router.get(
  "/candidates/:id/saved-searches",
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params.id);
    if (!canActOnCandidate(req.currentUser, candidateId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db
      .select()
      .from(candidateSavedSearchesTable)
      .where(eq(candidateSavedSearchesTable.candidateId, candidateId))
      .orderBy(desc(candidateSavedSearchesTable.createdAt));

    const enriched = await Promise.all(
      rows.map(async (s) => {
        const c = await newMatchCount(s.searchText, s.jobType, s.lastSeenJobId);
        return serializeSavedSearch(s, c);
      }),
    );
    res.json(enriched);
  },
);

router.post(
  "/candidates/:id/saved-searches",
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params.id);
    if (!canActOnCandidate(req.currentUser, candidateId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = CreateSavedSearchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [maxRow] = await db
      .select({ maxId: sql<number>`coalesce(max(${jobsTable.id}), 0)::int` })
      .from(jobsTable);
    const lastSeenJobId = Number(maxRow?.maxId ?? 0);

    const [created] = await db
      .insert(candidateSavedSearchesTable)
      .values({
        candidateId,
        name: parsed.data.name,
        searchText: parsed.data.searchText ?? null,
        jobType: parsed.data.jobType ?? null,
        alertsEnabled: parsed.data.alertsEnabled ?? true,
        lastSeenJobId,
      })
      .returning();

    res.status(201).json(serializeSavedSearch(created, 0));
  },
);

router.patch(
  "/candidates/:id/saved-searches/:searchId",
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params.id);
    const searchId = Number(req.params.searchId);
    if (!canActOnCandidate(req.currentUser, candidateId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = UpdateSavedSearchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(candidateSavedSearchesTable)
      .where(
        and(
          eq(candidateSavedSearchesTable.id, searchId),
          eq(candidateSavedSearchesTable.candidateId, candidateId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }

    const updates: Partial<typeof candidateSavedSearchesTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.alertsEnabled !== undefined)
      updates.alertsEnabled = parsed.data.alertsEnabled;
    if (parsed.data.markSeen) {
      const [maxRow] = await db
        .select({ maxId: sql<number>`coalesce(max(${jobsTable.id}), 0)::int` })
        .from(jobsTable);
      updates.lastSeenJobId = Number(maxRow?.maxId ?? 0);
    }

    const [updated] =
      Object.keys(updates).length === 0
        ? [existing]
        : await db
            .update(candidateSavedSearchesTable)
            .set(updates)
            .where(eq(candidateSavedSearchesTable.id, searchId))
            .returning();

    const c = await newMatchCount(
      updated.searchText,
      updated.jobType,
      updated.lastSeenJobId,
    );
    res.json(serializeSavedSearch(updated, c));
  },
);

router.delete(
  "/candidates/:id/saved-searches/:searchId",
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params.id);
    const searchId = Number(req.params.searchId);
    if (!canActOnCandidate(req.currentUser, candidateId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await db
      .delete(candidateSavedSearchesTable)
      .where(
        and(
          eq(candidateSavedSearchesTable.id, searchId),
          eq(candidateSavedSearchesTable.candidateId, candidateId),
        ),
      );
    res.status(204).send();
  },
);

export default router;

