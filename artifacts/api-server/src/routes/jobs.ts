import { Router, type IRouter } from "express";
import { eq, sql, desc, and, ilike, or } from "drizzle-orm";
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
import { calculateMatchScore, createMatchScoreMemo } from "../lib/matching";
import {
  parseLimit,
  encodeCursor,
  decodeCursor,
  setNextCursor,
} from "../lib/pagination";
import { sendNotificationToCandidate } from "../lib/notifier";
import { requireAuth, attachUser } from "../middleware/require-auth";
import { requirePermission } from "../lib/permissions";
import { sweepExpiredJobTiers } from "./job-tier";

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
  employer: { name: string; logoUrl: string; fastTrackEnabled?: boolean | null },
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
    // Surface the Fast-Track pledge so the candidate-facing UI can
    // badge the card without an extra round-trip. The full employer
    // row is always joined in the list query.
    fastTrack: Boolean(employer.fastTrackEnabled),
    applicationsCount,
    postedAt: j.postedAt.toISOString(),
  };
}

// Cursor shape: (tierRank, featured, postedAt(ms), id) lex-ordered to
// match the ORDER BY. tierRank is a derived 1..3 integer (see SQL
// CASE below).
type JobsCursor = {
  t: 1 | 2 | 3;
  f: 0 | 1;
  p: number;
  i: number;
};

router.get("/jobs", async (req, res): Promise<void> => {
  const params = ListJobsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const filters = params.data;
  const limit = parseLimit((req.query as { limit?: unknown }).limit);
  const cursor = decodeCursor<JobsCursor>(
    (req.query as { cursor?: unknown }).cursor,
  );

  // Demote anything whose paid tier has expired before we read+rank.
  // Cheap UPDATE; safe under concurrency.
  await sweepExpiredJobTiers();

  // Tier rank: sponsored > promoted > free. Fall back to recency.
  const tierRank = sql<number>`CASE ${jobsTable.tier}
    WHEN 'sponsored' THEN 3
    WHEN 'promoted' THEN 2
    ELSE 1 END`;

  // Push every filter into SQL (kills the previous post-query .filter()
  // pass + the shared `jobMatchesFilters` in-memory predicate). The
  // saved-search digest worker still uses `jobMatchesFilters` on rows
  // it already loaded, so this is route-local only.
  const conditions: ReturnType<typeof eq>[] = [
    eq(jobsTable.visibility, "public"),
  ];
  if (filters.search) {
    const q = `%${filters.search}%`;
    const skillsBlob = sql<string>`array_to_string(${jobsTable.skills}, ' ')`;
    const orClause = or(
      ilike(jobsTable.title, q),
      ilike(jobsTable.summary, q),
      sql`${skillsBlob} ILIKE ${q}`,
    );
    if (orClause) conditions.push(orClause);
  }
  if (filters.type) conditions.push(eq(jobsTable.type, filters.type));
  if (filters.location) {
    conditions.push(ilike(jobsTable.location, `%${filters.location}%`));
  }
  if (filters.remote !== undefined && filters.remote !== null) {
    conditions.push(eq(jobsTable.remote, filters.remote));
  }
  if (filters.employerId) {
    conditions.push(eq(jobsTable.employerId, filters.employerId));
  }
  if (filters.featured !== undefined && filters.featured !== null) {
    conditions.push(eq(jobsTable.featured, filters.featured));
  }
  if (filters.skill) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM unnest(${jobsTable.skills}) s
        WHERE lower(s) = lower(${filters.skill})
      )`,
    );
  }
  if (filters.fastTrackOnly) {
    conditions.push(eq(employersTable.fastTrackEnabled, true));
  }
  if (cursor) {
    conditions.push(
      sql`(
        ${tierRank},
        (${jobsTable.featured})::int,
        ${jobsTable.postedAt},
        ${jobsTable.id}
      ) < (${cursor.t}, ${cursor.f}, to_timestamp(${cursor.p / 1000}), ${cursor.i})`,
    );
  }

  const rows = await db
    .select({
      job: jobsTable,
      employer: employersTable,
      applicationsCount: sql<number>`coalesce((SELECT count(*)::int FROM ${applicationsTable} WHERE ${applicationsTable.jobId} = ${jobsTable.id}), 0)`,
      tierRank: tierRank,
    })
    .from(jobsTable)
    .innerJoin(employersTable, eq(jobsTable.employerId, employersTable.id))
    .where(and(...conditions))
    .orderBy(
      desc(tierRank),
      desc(jobsTable.featured),
      desc(jobsTable.postedAt),
      desc(jobsTable.id),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const next = hasMore && last
    ? encodeCursor({
        t: (last.tierRank as 1 | 2 | 3),
        f: last.job.featured ? 1 : 0,
        p: last.job.postedAt.getTime(),
        i: last.job.id,
      } satisfies JobsCursor)
    : null;
  setNextCursor(res, next);

  res.json(
    page.map(({ job, employer, applicationsCount }) =>
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
    .select({
      name: employersTable.name,
      logoUrl: employersTable.logoUrl,
      fastTrackEnabled: employersTable.fastTrackEnabled,
    })
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

router.get("/jobs/:id", attachUser, async (req, res): Promise<void> => {
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

  // Private jobs (e.g. reverse-offer bridge jobs) are visible only to
  // the owning employer, an admin, or the candidate(s) whose
  // application bridges them. Everyone else gets a 404 to avoid
  // confirming existence.
  if (row.job.visibility !== "public") {
    const user = req.currentUser;
    const isOwner =
      user?.role === "employer" && user.employerId === row.job.employerId;
    const isAdmin = user?.role === "admin";
    let isLinkedCandidate = false;
    if (user?.role === "candidate" && user.candidateId) {
      const [linked] = await db
        .select({ id: applicationsTable.id })
        .from(applicationsTable)
        .where(
          and(
            eq(applicationsTable.jobId, row.job.id),
            eq(applicationsTable.candidateId, user.candidateId),
          ),
        )
        .limit(1);
      isLinkedCandidate = Boolean(linked);
    }
    if (!isOwner && !isAdmin && !isLinkedCandidate) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
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

  // Match data exposes candidate identities + ranking, so it must only
  // be readable by the owning employer (or an admin). Public jobs from
  // other employers were previously readable by any authenticated user.
  const matchUser = req.currentUser!;
  const isOwner =
    matchUser.role === "employer" && matchUser.employerId === job.employerId;
  const isAdmin = matchUser.role === "admin";
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: "Not authorized to view matches for this job" });
    return;
  }

  const candidates = await db.select().from(candidatesTable);

  // Memo match scores by (skills, years, talent) so duplicate candidate
  // profiles (or matching candidates ranked against multiple jobs) skip
  // redundant skill-set + loop work. Per-request scope only.
  const memoScore = createMatchScoreMemo();
  const ranked = candidates
    .map((c) => {
      const breakdown = memoScore(
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
