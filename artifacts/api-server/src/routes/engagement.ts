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

/**
 * Candidate-facing milestone vocabulary.
 *
 * The raw `applications.status` enum mixes employer pipeline states
 * (screening, offer) with terminal outcomes (hired, rejected) and uses
 * names that don't track how a candidate thinks about progress. The
 * timeline endpoint exposes a stable, candidate-facing 5-step
 * progression instead — Submitted → Reviewed → Shortlisted →
 * Interview → Decision — and a separate `withdrawn` leaf that's
 * appended only when applicable.
 *
 * `MILESTONE_REACHED_AT` is the source of truth for "has the
 * application reached this milestone yet?". For each milestone we list
 * the raw statuses that imply it (an interview means we were
 * shortlisted, hired implies we reached Decision, etc.).
 */
const MILESTONE_KEYS = [
  "submitted",
  "reviewed",
  "shortlisted",
  "interview",
  "decision",
] as const;
type MilestoneKey = (typeof MILESTONE_KEYS)[number];

const MILESTONE_LABEL: Record<MilestoneKey | "withdrawn", string> = {
  submitted: "Submitted",
  reviewed: "Reviewed",
  shortlisted: "Shortlisted",
  interview: "Interview",
  decision: "Decision",
  withdrawn: "Withdrawn",
};

// For each milestone, the raw statuses that imply it has been reached.
// Order matters here only for selecting the *earliest* status that
// triggered the milestone (used to attribute reachedAt timestamps).
const MILESTONE_TRIGGERS: Record<MilestoneKey, readonly string[]> = {
  submitted: ["applied"],
  reviewed: ["screening", "interview", "offer", "hired"],
  shortlisted: ["interview", "offer", "hired"],
  interview: ["interview", "offer", "hired"],
  decision: ["offer", "hired", "rejected"],
};

function rawStatusToCurrentMilestone(status: string): MilestoneKey | "withdrawn" {
  if (status === "withdrawn") return "withdrawn";
  if (status === "offer" || status === "hired" || status === "rejected") return "decision";
  if (status === "interview") return "interview";
  if (status === "screening") return "reviewed";
  return "submitted";
}

// ---------------------------------------------------------------------------
// Data-derived ETA medians
// ---------------------------------------------------------------------------
// Walk every application's status_history in chronological order; for
// each consecutive pair (prev → next) record the elapsed days against
// `prev.status`. The median across all such observations is "how long
// employers typically spend in this step before moving on". We cache
// the result for an hour so a flurry of timeline requests doesn't
// re-scan the history table on every call.
//
// `ETA_FALLBACK_DAYS` is used only until we have at least
// `ETA_MIN_SAMPLES` real observations for a given status — newly
// deployed installs would otherwise show "Awaiting next step" for
// every active application, which is worse UX than a sane default.

const ETA_TTL_MS = 60 * 60 * 1000;
const ETA_MIN_SAMPLES = 3;
const ETA_FALLBACK_DAYS: Record<string, number> = {
  applied: 5,
  screening: 4,
  interview: 7,
  offer: 3,
};

interface EtaMedians {
  computedAt: number;
  byStatus: Map<string, { days: number; n: number }>;
}
let etaCache: EtaMedians | null = null;

async function getEtaMedians(): Promise<EtaMedians["byStatus"]> {
  if (etaCache && Date.now() - etaCache.computedAt < ETA_TTL_MS) {
    return etaCache.byStatus;
  }
  const rows = await db
    .select({
      appId: applicationStatusHistoryTable.applicationId,
      status: applicationStatusHistoryTable.status,
      changedAt: applicationStatusHistoryTable.changedAt,
    })
    .from(applicationStatusHistoryTable)
    .orderBy(
      applicationStatusHistoryTable.applicationId,
      applicationStatusHistoryTable.changedAt,
    );

  const samples = new Map<string, number[]>();
  let prev: (typeof rows)[number] | null = null;
  for (const r of rows) {
    if (prev && prev.appId === r.appId) {
      const days = (r.changedAt.getTime() - prev.changedAt.getTime()) / 86_400_000;
      if (days >= 0 && days < 365) {
        const arr = samples.get(prev.status) ?? [];
        arr.push(days);
        samples.set(prev.status, arr);
      }
    }
    prev = r;
  }

  const byStatus = new Map<string, { days: number; n: number }>();
  for (const [status, arr] of samples) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = sorted.length >>> 1;
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    byStatus.set(status, { days: Math.max(1, Math.round(median)), n: arr.length });
  }
  etaCache = { computedAt: Date.now(), byStatus };
  return byStatus;
}

/** Exported so the worker / tests can drop the cache after seeding. */
export function invalidateEtaMediansCache(): void {
  etaCache = null;
}

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
      // Spec: surface exactly the top 3 ranked next actions.
      suggestions: suggestions.slice(0, 3),
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

  // Build a map of raw status -> earliest reachedAt timestamp.
  // Always seed "applied" from the application's appliedAt so older
  // applications (created before status_history existed) still show
  // the Submitted milestone instead of an empty timeline.
  const rawReachedAt = new Map<string, Date>();
  rawReachedAt.set("applied", row.app.appliedAt);
  for (const h of history) {
    if (!rawReachedAt.has(h.status)) rawReachedAt.set(h.status, h.changedAt);
  }
  // If the current status never made it into history, fall back to
  // the application's updatedAt so the current milestone is visible.
  if (!rawReachedAt.has(row.app.status)) {
    rawReachedAt.set(row.app.status, row.app.updatedAt);
  }

  const isTerminalRejected = row.app.status === "rejected";
  const isTerminalWithdrawn = row.app.status === "withdrawn";
  const currentMilestone = rawStatusToCurrentMilestone(row.app.status);

  type MilestoneOut = {
    key: MilestoneKey | "withdrawn";
    label: string;
    rawStatus: string | null;
    reachedAt: string | null;
    isReached: boolean;
    isCurrent: boolean;
  };

  const milestones: MilestoneOut[] = MILESTONE_KEYS.map((key) => {
    // Earliest raw status that triggered this milestone, with its time.
    let bestAt: Date | null = null;
    let bestStatus: string | null = null;
    for (const trigger of MILESTONE_TRIGGERS[key]) {
      const at = rawReachedAt.get(trigger);
      if (at && (bestAt === null || at < bestAt)) {
        bestAt = at;
        bestStatus = trigger;
      }
    }
    return {
      key,
      label: MILESTONE_LABEL[key],
      rawStatus: bestStatus,
      reachedAt: bestAt ? bestAt.toISOString() : null,
      isReached: bestAt !== null,
      isCurrent: key === currentMilestone,
    };
  });

  if (isTerminalWithdrawn) {
    milestones.push({
      key: "withdrawn",
      label: MILESTONE_LABEL.withdrawn,
      rawStatus: "withdrawn",
      reachedAt: (rawReachedAt.get("withdrawn") ?? row.app.updatedAt).toISOString(),
      isReached: true,
      isCurrent: true,
    });
  }

  // ----- ETA: data-derived median, with fallback for cold start -----
  let etaDays: number | null = null;
  let etaSource: "data" | "fallback" | "none" = "none";
  let etaSampleSize = 0;
  let etaLabel = "";

  if (isTerminalRejected || isTerminalWithdrawn) {
    etaLabel = isTerminalRejected
      ? "This application has been closed by the employer."
      : "You withdrew this application.";
  } else if (row.app.status === "hired") {
    etaLabel = "You're hired — congratulations!";
  } else {
    const medians = await getEtaMedians();
    const observed = medians.get(row.app.status);
    let pickedDays: number | null = null;
    if (observed && observed.n >= ETA_MIN_SAMPLES) {
      pickedDays = observed.days;
      etaSource = "data";
      etaSampleSize = observed.n;
    } else {
      const fb = ETA_FALLBACK_DAYS[row.app.status];
      if (fb != null) {
        pickedDays = fb;
        etaSource = "fallback";
        etaSampleSize = observed?.n ?? 0;
      }
    }

    if (pickedDays != null) {
      etaDays = pickedDays;
      const since = rawReachedAt.get(row.app.status) ?? row.app.updatedAt;
      const elapsed = Math.floor(
        (Date.now() - since.getTime()) / 86_400_000,
      );
      const remaining = Math.max(0, pickedDays - elapsed);
      const sourceQualifier =
        etaSource === "data"
          ? ` (median across ${etaSampleSize} similar applications)`
          : "";
      etaLabel =
        remaining === 0
          ? `Employer response is due any day now${sourceQualifier}.`
          : `Most employers respond in ${pickedDays} day${pickedDays === 1 ? "" : "s"}${sourceQualifier}.`;
    } else {
      etaLabel = "Awaiting next step.";
    }
  }

  res.json({
    applicationId: id,
    currentStatus: row.app.status,
    currentMilestone,
    milestones,
    etaDays,
    etaSource,
    etaSampleSize,
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

function parseFiltersJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
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
    sortBy: s.sortBy,
    filters: parseFiltersJson(s.filtersJson),
    emailAlerts: s.emailAlerts,
    inAppAlerts: s.inAppAlerts,
    alertsEnabled: s.alertsEnabled,
    createdAt: s.createdAt.toISOString(),
    lastAlertedAt: s.lastAlertedAt ? s.lastAlertedAt.toISOString() : null,
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

    const emailAlerts = parsed.data.emailAlerts ?? true;
    const inAppAlerts = parsed.data.inAppAlerts ?? true;
    const [created] = await db
      .insert(candidateSavedSearchesTable)
      .values({
        candidateId,
        name: parsed.data.name,
        searchText: parsed.data.searchText ?? null,
        jobType: parsed.data.jobType ?? null,
        sortBy: parsed.data.sortBy ?? null,
        filtersJson: JSON.stringify(parsed.data.filters ?? {}),
        emailAlerts,
        inAppAlerts,
        // Legacy mirror so older clients reading `alertsEnabled` still
        // see whether *any* alert channel is on.
        alertsEnabled: emailAlerts || inAppAlerts,
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
    if (parsed.data.sortBy !== undefined) updates.sortBy = parsed.data.sortBy;
    if (parsed.data.filters !== undefined)
      updates.filtersJson = JSON.stringify(parsed.data.filters);

    const nextEmail = parsed.data.emailAlerts ?? existing.emailAlerts;
    const nextInApp = parsed.data.inAppAlerts ?? existing.inAppAlerts;
    if (parsed.data.emailAlerts !== undefined) updates.emailAlerts = nextEmail;
    if (parsed.data.inAppAlerts !== undefined) updates.inAppAlerts = nextInApp;
    if (
      parsed.data.emailAlerts !== undefined ||
      parsed.data.inAppAlerts !== undefined
    ) {
      // Keep legacy mirror in sync with whichever channel is on.
      updates.alertsEnabled = nextEmail || nextInApp;
    }
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

