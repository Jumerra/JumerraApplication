import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import {
  db,
  jobsTable,
  employersTable,
  applicationsTable,
  candidatesTable,
  jobChallengesTable,
} from "@workspace/db";
import { buildDefaultChallengeForSkills } from "./skill-challenges";
import {
  ListJobsQueryParams,
  CreateJobBody,
  GetJobParams,
  GetJobMatchesParams,
} from "@workspace/api-zod";
import { calculateMatchScore } from "../lib/matching";
import { sendNotificationToCandidate } from "../lib/notifier";
import { requireAuth } from "../middleware/require-auth";
import { requirePermission } from "../lib/permissions";
import { sweepExpiredJobTiers } from "./job-tier";
import { jobMatchesFilters } from "../lib/job-filters";

const router: IRouter = Router();

function effectiveTier(j: typeof jobsTable.$inferSelect): {
  tier: "free" | "promoted" | "sponsored";
  tierExpiresAt: Date | null;
} {
  // Defensive runtime read of tier — DB column has a default but the
  // expiry sweep already runs before each list, so this should always
  // match what's persisted. Belt-and-braces clamp to 'free' if expired.
  const t = (j.tier ?? "free") as "free" | "promoted" | "sponsored";
  if (
    t !== "free" &&
    j.tierExpiresAt &&
    j.tierExpiresAt.getTime() <= Date.now()
  ) {
    return { tier: "free", tierExpiresAt: null };
  }
  return { tier: t, tierExpiresAt: j.tierExpiresAt };
}

function serializeJob(
  j: typeof jobsTable.$inferSelect,
  employer: { name: string; logoUrl: string },
  applicationsCount: number,
) {
  const { tier, tierExpiresAt } = effectiveTier(j);
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
    tier,
    tierExpiresAt: tierExpiresAt ? tierExpiresAt.toISOString() : null,
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

  // Demote anything whose paid tier has expired before we read+rank.
  // Cheap UPDATE; safe under concurrency.
  await sweepExpiredJobTiers();

  // Tier rank: sponsored > promoted > free. Fall back to recency.
  const tierRank = sql<number>`CASE ${jobsTable.tier}
    WHEN 'sponsored' THEN 3
    WHEN 'promoted' THEN 2
    ELSE 1 END`;

  const rows = await db
    .select({
      job: jobsTable,
      employer: employersTable,
      applicationsCount: sql<number>`coalesce((SELECT count(*)::int FROM ${applicationsTable} WHERE ${applicationsTable.jobId} = ${jobsTable.id}), 0)`,
    })
    .from(jobsTable)
    .innerJoin(employersTable, eq(jobsTable.employerId, employersTable.id))
    .orderBy(desc(tierRank), desc(jobsTable.featured), desc(jobsTable.postedAt));

  // Delegate the per-row predicate to the shared helper so the
  // saved-search alert worker (lib/digest-worker.ts) matches with
  // identical semantics. See lib/job-filters.ts for the contract.
  const filtered = rows.filter(({ job }) => jobMatchesFilters(job, params.data));

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

  // Posting a job is now ALWAYS free — the freemium per-job tier model
  // (Free / Promoted / Sponsored) replaces the recurring paywall.
  // Paid tiers must still go through POST /jobs/:id/promote/checkout
  // to actually activate; clients that pass `tier: 'promoted'|'sponsored'`
  // here just get a free job (server clamps it) until payment lands.
  const { tier: _ignoredTier, targetSkills, targetLocation, ...rest } =
    parsed.data;

  const [created] = await db
    .insert(jobsTable)
    .values({
      ...rest,
      employerId,
      featured: parsed.data.featured ?? false,
      tier: "free",
      tierExpiresAt: null,
      targetSkills: targetSkills ?? [],
      targetLocation: targetLocation ?? null,
    })
    .returning();

  const [employer] = await db
    .select({ name: employersTable.name, logoUrl: employersTable.logoUrl })
    .from(employersTable)
    .where(eq(employersTable.id, created.employerId));

  // Fan-out "strong match" push to candidates whose saved profile
  // scores >= 70% against the new job. Capped + best-effort so a
  // slow notifier never blocks the POST response.
  void (async () => {
    try {
      const cands = await db
        .select({
          id: candidatesTable.id,
          skills: candidatesTable.skills,
          yearsExperience: candidatesTable.yearsExperience,
          talentScore: candidatesTable.talentScore,
        })
        .from(candidatesTable);
      const employerName = employer?.name ?? "An employer";
      let dispatched = 0;
      for (const c of cands) {
        if (dispatched >= 100) break; // safety cap per posting
        const { score } = calculateMatchScore(
          created.skills,
          c.skills,
          c.yearsExperience,
          c.talentScore,
        );
        if (score < 70) continue;
        await sendNotificationToCandidate(c.id, {
          kind: "strong_match",
          title: "New strong match",
          body: `${employerName} just posted "${created.title}" — you're a ${Math.round(score)}% match.`,
          link: `/jobs/${created.id}`,
          category: "strongMatch",
          data: { jobId: created.id, score: Math.round(score) },
        }).catch(() => {});
        dispatched += 1;
      }
    } catch {
      // best-effort
    }
  })();

  // Auto-attach a default skill challenge unless the employer
  // explicitly opted out (`includeChallenge: false`). Pulls one
  // template per matching job skill via the shared generator. Done
  // best-effort — a missing challenge is recoverable via the
  // PUT /jobs/:id/challenge endpoint.
  const includeChallenge =
    (req.body && (req.body as { includeChallenge?: boolean }).includeChallenge) !== false;
  if (includeChallenge) {
    try {
      const built = await buildDefaultChallengeForSkills(created.skills);
      if (built.questions.length > 0) {
        await db.insert(jobChallengesTable).values({
          jobId: created.id,
          title: "Skill challenge",
          questions: built.questions,
          passingScore: 50,
          // ~45 seconds per MCQ, with a 60s floor.
          durationSeconds: Math.max(60, built.questions.length * 45),
          templateIds: built.templateIds,
        });
      }
    } catch (err) {
      req.log.warn({ err }, "auto-attach challenge failed");
    }
  }

  res.status(201).json(serializeJob(created, employer ?? { name: "", logoUrl: "" }, 0));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await sweepExpiredJobTiers();

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
      const breakdown = calculateMatchScore(
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
        matchScore: breakdown.score,
        matchedSkills: breakdown.matchedSkills,
        matchBreakdown: breakdown,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 12);

  res.json(ranked);
});

export default router;
