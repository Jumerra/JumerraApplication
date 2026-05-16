/**
 * Per-user mobile-companion endpoints:
 *   - Expo push token registration / revocation
 *   - Notification preferences (per-category toggles)
 *   - For-You feed of ranked job matches with persisted dismissals
 *
 * All routes require an authenticated session and act on `currentUser`.
 * The For-You feed only makes sense for candidates and 4xx's other roles.
 */

import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  candidateDismissedJobsTable,
  candidatesTable,
  employersTable,
  expoPushTokensTable,
  jobsTable,
  notificationPrefsTable,
} from "@workspace/db";
import { calculateMatchScore } from "../lib/matching";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

router.use("/me", requireAuth);

// --- Push tokens ---------------------------------------------------------

const PushTokenBody = z.object({
  token: z.string().min(8).max(256),
  platform: z.enum(["ios", "android", "web", "unknown"]).default("unknown"),
});

router.post("/me/push-tokens", async (req, res) => {
  const parsed = PushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.currentUser!;
  try {
    // Upsert by token. If the same token was previously bound to a
    // different user (device handed off), reassign + bump lastSeenAt.
    await db
      .insert(expoPushTokensTable)
      .values({
        userId: me.id,
        token: parsed.data.token,
        platform: parsed.data.platform,
      })
      .onConflictDoUpdate({
        target: expoPushTokensTable.token,
        set: {
          userId: me.id,
          platform: parsed.data.platform,
          lastSeenAt: new Date(),
        },
      });
    res.json({ ok: true });
  } catch (err) {
    req.log.warn({ err }, "register push token failed");
    res.status(500).json({ error: "Failed to register token" });
  }
});

router.delete("/me/push-tokens", async (req, res) => {
  const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.currentUser!;
  await db
    .delete(expoPushTokensTable)
    .where(
      and(
        eq(expoPushTokensTable.token, parsed.data.token),
        eq(expoPushTokensTable.userId, me.id),
      ),
    );
  res.json({ ok: true });
});

// --- Notification preferences --------------------------------------------

const PREF_DEFAULTS = {
  strongMatch: true,
  applicationStatus: true,
  interviewReminder: true,
  profileViewed: true,
};

router.get("/me/notification-prefs", async (req, res) => {
  const me = req.currentUser!;
  const [row] = await db
    .select()
    .from(notificationPrefsTable)
    .where(eq(notificationPrefsTable.userId, me.id))
    .limit(1);
  res.json({
    strongMatch: row?.strongMatch ?? PREF_DEFAULTS.strongMatch,
    applicationStatus:
      row?.applicationStatus ?? PREF_DEFAULTS.applicationStatus,
    interviewReminder:
      row?.interviewReminder ?? PREF_DEFAULTS.interviewReminder,
    profileViewed: row?.profileViewed ?? PREF_DEFAULTS.profileViewed,
  });
});

const PrefsBody = z.object({
  strongMatch: z.boolean().optional(),
  applicationStatus: z.boolean().optional(),
  interviewReminder: z.boolean().optional(),
  profileViewed: z.boolean().optional(),
});

router.put("/me/notification-prefs", async (req, res) => {
  const parsed = PrefsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.currentUser!;
  const patch = parsed.data;

  // Compute the merged final state in one shot so onConflict can
  // overwrite atomically. Read existing first, then write the union.
  const [existing] = await db
    .select()
    .from(notificationPrefsTable)
    .where(eq(notificationPrefsTable.userId, me.id))
    .limit(1);

  const merged = {
    strongMatch:
      patch.strongMatch ?? existing?.strongMatch ?? PREF_DEFAULTS.strongMatch,
    applicationStatus:
      patch.applicationStatus ??
      existing?.applicationStatus ??
      PREF_DEFAULTS.applicationStatus,
    interviewReminder:
      patch.interviewReminder ??
      existing?.interviewReminder ??
      PREF_DEFAULTS.interviewReminder,
    profileViewed:
      patch.profileViewed ??
      existing?.profileViewed ??
      PREF_DEFAULTS.profileViewed,
  };

  await db
    .insert(notificationPrefsTable)
    .values({ userId: me.id, ...merged, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: notificationPrefsTable.userId,
      set: { ...merged, updatedAt: new Date() },
    });

  res.json(merged);
});

// --- For You feed --------------------------------------------------------

router.get("/me/feed", async (req, res) => {
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "For You feed is candidate-only" });
    return;
  }
  const candidateId = me.candidateId;

  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candidateId))
    .limit(1);
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  // Pull dismissed job ids and applied job ids; both filter the feed.
  const dismissed = await db
    .select({ jobId: candidateDismissedJobsTable.jobId })
    .from(candidateDismissedJobsTable)
    .where(eq(candidateDismissedJobsTable.candidateId, candidateId));
  const dismissedSet = new Set(dismissed.map((r) => r.jobId));

  const applied = await db.execute(
    sql`select job_id as "jobId" from applications where candidate_id = ${candidateId}`,
  );
  const appliedSet = new Set(
    (applied.rows as { jobId: number }[]).map((r) => r.jobId),
  );

  const jobs = await db
    .select({ job: jobsTable, employer: employersTable })
    .from(jobsTable)
    .leftJoin(employersTable, eq(jobsTable.employerId, employersTable.id))
    .limit(500);

  const ranked = jobs
    .filter(
      ({ job }) => !dismissedSet.has(job.id) && !appliedSet.has(job.id),
    )
    .map(({ job, employer }) => {
      const breakdown = calculateMatchScore(
        job.skills,
        candidate.skills,
        candidate.yearsExperience,
        candidate.talentScore,
      );
      const tier = (job.tier ?? "free") as "free" | "promoted" | "sponsored";
      const tierBias = tier === "sponsored" ? 25 : tier === "promoted" ? 10 : 0;
      return {
        jobId: job.id,
        title: job.title,
        description: job.description,
        location: job.location,
        type: job.type,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        currency: job.currency,
        skills: job.skills,
        employer: employer
          ? {
              id: employer.id,
              name: employer.name,
              logoUrl: employer.logoUrl,
              industry: employer.industry,
              location: employer.location,
            }
          : null,
        matchScore: Math.min(100, breakdown.score + tierBias),
        matchedSkills: breakdown.matchedSkills,
        missingSkills: breakdown.missingSkills,
        summary: breakdown.summary,
        tier,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 30);

  res.json({ items: ranked });
});

router.post("/me/feed/dismiss", async (req, res) => {
  const parsed = z
    .object({ jobId: z.number().int().positive() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "Candidate-only" });
    return;
  }
  try {
    await db
      .insert(candidateDismissedJobsTable)
      .values({ candidateId: me.candidateId, jobId: parsed.data.jobId })
      .onConflictDoNothing();
  } catch (err) {
    req.log.warn({ err }, "dismiss feed job failed");
  }
  res.json({ ok: true });
});

/**
 * Used by the mobile one-tap apply confirm sheet. Returns the cached
 * AI CV text + a candidate snapshot so the UI can show what's about to
 * be submitted without firing the heavier `/candidates/:id` query.
 */
router.get("/me/apply-snapshot", async (req, res) => {
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "Candidate-only" });
    return;
  }
  const [c] = await db
    .select({
      id: candidatesTable.id,
      fullName: candidatesTable.fullName,
      headline: candidatesTable.headline,
      avatarUrl: candidatesTable.avatarUrl,
      skills: candidatesTable.skills,
      aiCvText: candidatesTable.aiCvText,
      aiCvUnlocked: candidatesTable.aiCvUnlocked,
    })
    .from(candidatesTable)
    .where(eq(candidatesTable.id, me.candidateId))
    .limit(1);
  if (!c) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json({
    candidate: {
      id: c.id,
      fullName: c.fullName,
      headline: c.headline,
      avatarUrl: c.avatarUrl,
      skills: c.skills,
    },
    cv: {
      hasGeneratedCv: Boolean(c.aiCvText),
      aiCvUnlocked: c.aiCvUnlocked,
      preview: c.aiCvText ? c.aiCvText.slice(0, 400) : null,
    },
  });
});

// suppress unused-import lint; inArray is reserved for future bulk ops
void inArray;

export default router;
