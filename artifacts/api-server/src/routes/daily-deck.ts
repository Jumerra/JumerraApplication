/**
 * Employer swipe-back daily candidate deck (Task #79).
 *
 * GET  /me/daily-deck                          — today's ranked 10-card stack
 * POST /me/daily-deck/:candidateId/shortlist   — right-swipe (add to pool + notify)
 * POST /me/daily-deck/:candidateId/dismiss     — left-swipe (never show again)
 *
 * The deck is computed lazily on the first GET of each calendar day,
 * cached in `employer_daily_decks` so refresh / re-mounts return a
 * stable order, and naturally excludes anyone the employer has already
 * shortlisted or dismissed.
 */

import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  candidatesTable,
  employersTable,
  employerDailyDecksTable,
  employerDismissedCandidatesTable,
  employerTalentPoolsTable,
  employerTalentPoolMembersTable,
  jobsTable,
} from "@workspace/db";
import { calculateMatchScore } from "../lib/matching";
import { sendNotificationToCandidate } from "../lib/notifier";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
const DECK_SIZE = 10;
const CANDIDATE_POOL_CAP = 500;

/**
 * Returns the YYYY-MM-DD calendar date *in the given IANA timezone*.
 * The deck rolls over at local midnight in the employer's preferred
 * zone so the "today" key matches what the recruiter sees on their
 * own clock, not UTC's clock. Falls back to UTC if the zone is
 * invalid (Intl throws RangeError on unknown identifiers).
 */
function localDeckDate(timeZone: string, refreshHour: number): string {
  // Shift "now" backwards by `refreshHour` hours so the local
  // calendar-day key only flips forward once the recruiter's chosen
  // refresh hour has been reached. e.g. refreshHour=8 means a query
  // at 07:59 local still resolves to *yesterday*; 08:00 flips to
  // today and a new deck is computed.
  const safeHour = Number.isFinite(refreshHour)
    ? Math.max(0, Math.min(23, Math.trunc(refreshHour)))
    : 0;
  const shifted = new Date(Date.now() - safeHour * 60 * 60 * 1000);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(shifted);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fall through to UTC
  }
  return shifted.toISOString().slice(0, 10);
}

/**
 * Resolves the signed-in employer or writes the appropriate error.
 * Returns null on failure (response already sent).
 */
async function resolveEmployer(
  req: Parameters<Parameters<typeof router.get>[1]>[0],
  res: Parameters<Parameters<typeof router.get>[1]>[1],
) {
  const me = req.currentUser!;
  if (me.role !== "employer" || me.employerId == null) {
    res.status(403).json({ error: "Daily deck is employer-only" });
    return null;
  }
  const [employer] = await db
    .select()
    .from(employersTable)
    .where(eq(employersTable.id, me.employerId))
    .limit(1);
  if (!employer) {
    res.status(404).json({ error: "Employer not found" });
    return null;
  }
  return employer;
}

/** Loads the employer's currently-active public job postings. */
async function loadActiveJobs(employerId: number) {
  const now = new Date();
  const rows = await db
    .select({
      id: jobsTable.id,
      title: jobsTable.title,
      skills: jobsTable.skills,
    })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.employerId, employerId),
        eq(jobsTable.visibility, "public"),
        or(
          isNull(jobsTable.tierExpiresAt),
          gte(jobsTable.tierExpiresAt, now),
        ),
      ),
    );
  return rows;
}

type RankedCandidate = {
  candidateId: number;
  bestJobId: number | null;
  bestJobTitle: string | null;
  matchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  summary: string;
};

/**
 * Score every fetched candidate against every active job and keep the
 * single best (jobId, score, breakdown) per candidate. Returns the
 * top-N ranked.
 */
function rankCandidates(
  candidates: Array<typeof candidatesTable.$inferSelect>,
  jobs: Array<{ id: number; title: string; skills: string[] }>,
  excludeIds: Set<number>,
  limit: number,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];
  for (const c of candidates) {
    if (excludeIds.has(c.id)) continue;
    if (!c.openToOffers) continue;
    let best: RankedCandidate | null = null;
    if (jobs.length === 0) {
      const br = calculateMatchScore([], c.skills, c.yearsExperience, c.talentScore);
      best = {
        candidateId: c.id,
        bestJobId: null,
        bestJobTitle: null,
        matchScore: br.score,
        matchedSkills: br.matchedSkills,
        missingSkills: br.missingSkills,
        summary: br.summary,
      };
    } else {
      for (const j of jobs) {
        const br = calculateMatchScore(
          j.skills,
          c.skills,
          c.yearsExperience,
          c.talentScore,
        );
        if (!best || br.score > best.matchScore) {
          best = {
            candidateId: c.id,
            bestJobId: j.id,
            bestJobTitle: j.title,
            matchScore: br.score,
            matchedSkills: br.matchedSkills,
            missingSkills: br.missingSkills,
            summary: br.summary,
          };
        }
      }
    }
    if (best) ranked.push(best);
  }
  ranked.sort((a, b) => b.matchScore - a.matchScore);
  return ranked.slice(0, limit);
}

function serializeCandidate(c: typeof candidatesTable.$inferSelect) {
  return {
    id: c.id,
    fullName: c.fullName,
    headline: c.headline,
    location: c.location,
    avatarUrl: c.avatarUrl,
    bio: c.bio,
    skills: c.skills,
    talentScore: c.talentScore,
    yearsExperience: c.yearsExperience,
    openToOffers: c.openToOffers,
  };
}

router.get("/me/daily-deck", requireAuth, async (req, res) => {
  const employer = await resolveEmployer(req, res);
  if (!employer) return;
  const deckDate = localDeckDate(
    employer.dailyDeckTimezone ?? "UTC",
    employer.dailyDeckRefreshHour ?? 0,
  );

  // Already-shortlisted candidates (anyone in any pool for this employer)
  // and explicitly dismissed ones are excluded from new decks.
  const dismissed = await db
    .select({ candidateId: employerDismissedCandidatesTable.candidateId })
    .from(employerDismissedCandidatesTable)
    .where(eq(employerDismissedCandidatesTable.employerId, employer.id));
  const shortlistedRows = await db
    .select({ candidateId: employerTalentPoolMembersTable.candidateId })
    .from(employerTalentPoolMembersTable)
    .innerJoin(
      employerTalentPoolsTable,
      eq(employerTalentPoolMembersTable.poolId, employerTalentPoolsTable.id),
    )
    .where(eq(employerTalentPoolsTable.employerId, employer.id));
  const excludeIds = new Set<number>([
    ...dismissed.map((r) => r.candidateId),
    ...shortlistedRows.map((r) => r.candidateId),
  ]);

  const jobs = await loadActiveJobs(employer.id);

  // Daily picks are explicitly defined as "ranked by fit against the
  // employer's open roles". With no active public jobs there is no
  // fit basis, so we return an empty deck rather than fabricate one.
  if (jobs.length === 0) {
    res.json({ deckDate, openJobsCount: 0, items: [] });
    return;
  }

  // Look for a cached deck for today. We trust the cached order but
  // re-fetch candidate detail at read-time so shortlist/dismiss between
  // requests is reflected by simply filtering against the exclude set.
  const [cached] = await db
    .select()
    .from(employerDailyDecksTable)
    .where(
      and(
        eq(employerDailyDecksTable.employerId, employer.id),
        eq(employerDailyDecksTable.deckDate, deckDate),
      ),
    )
    .limit(1);

  let orderedIds: number[];
  if (cached) {
    orderedIds = (cached.candidateIds ?? []).filter(
      (id) => !excludeIds.has(id),
    );
  } else {
    const candidates = await db
      .select()
      .from(candidatesTable)
      .limit(CANDIDATE_POOL_CAP);
    const ranked = rankCandidates(candidates, jobs, excludeIds, DECK_SIZE);
    orderedIds = ranked.map((r) => r.candidateId);
    try {
      await db
        .insert(employerDailyDecksTable)
        .values({
          employerId: employer.id,
          deckDate,
          candidateIds: orderedIds,
        })
        .onConflictDoNothing();
    } catch (err) {
      req.log.warn({ err }, "daily-deck: cache insert failed");
    }
  }

  if (orderedIds.length === 0) {
    res.json({ deckDate, items: [], openJobsCount: jobs.length });
    return;
  }

  // Re-hydrate candidate detail + recompute breakdown (cheap; <=10
  // candidates). Preserves cached order.
  const detailRows = await db
    .select()
    .from(candidatesTable)
    .where(inArray(candidatesTable.id, orderedIds));
  const byId = new Map(detailRows.map((c) => [c.id, c]));
  const items = orderedIds
    .map((id: number) => byId.get(id))
    .filter(
      (c): c is typeof candidatesTable.$inferSelect => c != null,
    )
    .map((c) => {
      let bestJobId: number | null = null;
      let bestJobTitle: string | null = null;
      let bestScore = 0;
      let bestMatched: string[] = [];
      let bestMissing: string[] = [];
      let bestSummary = "";
      if (jobs.length === 0) {
        const br = calculateMatchScore([], c.skills, c.yearsExperience, c.talentScore);
        bestScore = br.score;
        bestMatched = br.matchedSkills;
        bestMissing = br.missingSkills;
        bestSummary = br.summary;
      } else {
        for (const j of jobs) {
          const br = calculateMatchScore(
            j.skills,
            c.skills,
            c.yearsExperience,
            c.talentScore,
          );
          if (br.score > bestScore || bestJobId == null) {
            bestScore = br.score;
            bestMatched = br.matchedSkills;
            bestMissing = br.missingSkills;
            bestSummary = br.summary;
            bestJobId = j.id;
            bestJobTitle = j.title;
          }
        }
      }
      return {
        candidate: serializeCandidate(c),
        bestJobId,
        bestJobTitle,
        matchScore: bestScore,
        matchedSkills: bestMatched,
        missingSkills: bestMissing,
        summary: bestSummary,
      };
    });

  res.json({
    deckDate,
    openJobsCount: jobs.length,
    items,
  });
});

const ShortlistBody = z.object({
  poolId: z.number().int().positive().optional(),
  jobId: z.number().int().positive().optional(),
  poolName: z.string().min(1).max(120).optional(),
});

router.post(
  "/me/daily-deck/:candidateId/shortlist",
  requireAuth,
  async (req, res) => {
    const employer = await resolveEmployer(req, res);
    if (!employer) return;
    const candidateId = Number(req.params.candidateId);
    if (!Number.isFinite(candidateId) || candidateId <= 0) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }
    const parsed = ShortlistBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [candidate] = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, candidateId))
      .limit(1);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }

    // Resolve / create the pool. When a `jobId` is supplied (e.g.
    // from `bestJobId` on the deck card) we route into a per-role
    // shortlist pool named after the job title, so the matching role
    // gets its own pipeline. Falls back to a per-employer "Daily
    // picks" pool when no job context is available.
    let poolId = parsed.data.poolId;
    if (!poolId) {
      let derivedName = parsed.data.poolName ?? "Daily picks";
      if (parsed.data.jobId) {
        const [job] = await db
          .select({
            id: jobsTable.id,
            title: jobsTable.title,
            employerId: jobsTable.employerId,
          })
          .from(jobsTable)
          .where(eq(jobsTable.id, parsed.data.jobId))
          .limit(1);
        if (!job || job.employerId !== employer.id) {
          res.status(404).json({ error: "Job not found" });
          return;
        }
        derivedName = parsed.data.poolName ?? `${job.title} shortlist`;
      }
      const name = derivedName;
      const [existing] = await db
        .select()
        .from(employerTalentPoolsTable)
        .where(
          and(
            eq(employerTalentPoolsTable.employerId, employer.id),
            eq(employerTalentPoolsTable.name, name),
          ),
        )
        .limit(1);
      if (existing) {
        poolId = existing.id;
      } else {
        // Insert idempotently: if a concurrent request created the pool
        // first the unique index on (employerId, name) means we get an
        // empty returning() — fall back to re-selecting in that case.
        const inserted = await db
          .insert(employerTalentPoolsTable)
          .values({
            employerId: employer.id,
            name,
            description: "Auto-created from your daily candidate deck.",
            createdBy: req.currentUser!.id,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted[0]) {
          poolId = inserted[0].id;
        } else {
          const [raced] = await db
            .select()
            .from(employerTalentPoolsTable)
            .where(
              and(
                eq(employerTalentPoolsTable.employerId, employer.id),
                eq(employerTalentPoolsTable.name, name),
              ),
            )
            .limit(1);
          if (!raced) {
            res.status(500).json({ error: "Pool creation race could not be resolved" });
            return;
          }
          poolId = raced.id;
        }
      }
    } else {
      // Verify ownership of the supplied pool.
      const [owned] = await db
        .select({ id: employerTalentPoolsTable.id })
        .from(employerTalentPoolsTable)
        .where(
          and(
            eq(employerTalentPoolsTable.id, poolId),
            eq(employerTalentPoolsTable.employerId, employer.id),
          ),
        )
        .limit(1);
      if (!owned) {
        res.status(404).json({ error: "Pool not found" });
        return;
      }
    }

    const insertedMember = await db
      .insert(employerTalentPoolMembersTable)
      .values({
        poolId,
        candidateId,
        addedBy: req.currentUser!.id,
      })
      .onConflictDoNothing()
      .returning({ id: employerTalentPoolMembersTable.id });
    const wasNew = insertedMember.length > 0;

    // Notify the candidate only when we actually added a new shortlist
    // entry — prevents repeated swipes (or replayed POSTs) from spamming
    // the candidate with duplicate notifications.
    if (wasNew) try {
      await sendNotificationToCandidate(candidateId, {
        kind: "employer_interest",
        category: "profileViewed",
        title: `${employer.name} added you to their shortlist`,
        body: parsed.data.jobId
          ? "An employer is interested in your profile for an open role."
          : "An employer saved your profile to come back to.",
        link: "/dashboard/candidate",
      });
    } catch (err) {
      req.log.warn({ err }, "daily-deck: notification dispatch failed");
    }

    res.json({ ok: true, poolId });
  },
);

const DismissBody = z.object({
  reason: z.string().max(280).optional(),
  jobId: z.number().int().positive().nullish(),
});

router.post(
  "/me/daily-deck/:candidateId/dismiss",
  requireAuth,
  async (req, res) => {
    const employer = await resolveEmployer(req, res);
    if (!employer) return;
    const candidateId = Number(req.params.candidateId);
    if (!Number.isFinite(candidateId) || candidateId <= 0) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }
    const parsed = DismissBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Validate candidate exists up-front so we return 404 instead of
    // an opaque 500 from a downstream FK violation. Per-role dismissal
    // is supported via optional jobId (verified to belong to this
    // employer when provided).
    const [candidate] = await db
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(eq(candidatesTable.id, candidateId))
      .limit(1);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    if (parsed.data.jobId) {
      const [job] = await db
        .select({ id: jobsTable.id, employerId: jobsTable.employerId })
        .from(jobsTable)
        .where(eq(jobsTable.id, parsed.data.jobId))
        .limit(1);
      if (!job || job.employerId !== employer.id) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
    }

    try {
      await db
        .insert(employerDismissedCandidatesTable)
        .values({
          employerId: employer.id,
          candidateId,
          jobId: parsed.data.jobId ?? null,
          reason: parsed.data.reason ?? null,
        })
        .onConflictDoNothing();
    } catch (err) {
      // Unique-violation race is fine (the partial unique indexes
      // already guarantee idempotency). Anything else is a real DB
      // failure and should surface to the client as a 500.
      const code = (err as { code?: string }).code;
      if (code !== "23505") {
        req.log.error({ err }, "daily-deck: dismiss insert failed");
        res.status(500).json({ error: "Could not record dismissal" });
        return;
      }
    }

    res.json({ ok: true });
  },
);

export default router;
