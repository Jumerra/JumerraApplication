/**
 * Candidate growth-plan API. Task #75.
 *
 *   GET    /me/growth-plan                         — list + lazy refresh
 *   POST   /me/growth-plan/:skill/complete         — mark done, trigger reping
 *   POST   /me/growth-plan/:skill/dismiss          — hide forever
 *
 * All endpoints require a candidate session — there's no public surface.
 */

import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  candidateGrowthSkillsTable,
  db,
  usersTable,
} from "@workspace/db";
import { invalidateConstellationCache } from "../lib/career-constellation";
import { requireAuth } from "../middleware/require-auth";
import {
  listGrowthPlan,
  refreshGrowthPlan,
  repingEmployersForCompletedSkill,
} from "../lib/growth-plan";
import { z } from "zod";

const router: IRouter = Router();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolve the candidate-id for the current session.  Returns null
 * (not throws) so each route can choose the right error shape.
 */
async function getMyCandidateId(userId: number): Promise<number | null> {
  const [row] = await db
    .select({ candidateId: usersTable.candidateId })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return row?.candidateId ?? null;
}

router.get("/me/growth-plan", requireAuth, async (req, res) => {
  const userId = (req.session as { userId?: number }).userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const candidateId = await getMyCandidateId(userId);
  if (!candidateId) {
    res.status(403).json({ error: "Only candidates have a growth plan" });
    return;
  }

  // Lazy refresh: if no active rows, OR the newest active row is
  // older than 7 days, re-run the analyser.  Cheap on small data,
  // keeps the dashboard fresh without a background cron.
  const existing = await db
    .select({ addedAt: candidateGrowthSkillsTable.addedAt })
    .from(candidateGrowthSkillsTable)
    .where(
      and(
        eq(candidateGrowthSkillsTable.candidateId, candidateId),
        eq(candidateGrowthSkillsTable.status, "active"),
      ),
    );
  const newest = existing.reduce(
    (acc, r) => (r.addedAt > acc ? r.addedAt : acc),
    new Date(0),
  );
  const isStale =
    existing.length === 0 || Date.now() - newest.getTime() > SEVEN_DAYS_MS;
  if (isStale) {
    try {
      await refreshGrowthPlan(candidateId);
    } catch (err) {
      req.log.warn({ err, candidateId }, "growth-plan: refresh failed");
    }
  }

  const items = await listGrowthPlan(candidateId, { includeCompleted: true });
  res.json({ items });
});

const CompleteSchema = z.object({
  verificationUrl: z
    .string()
    .url()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

router.post(
  "/me/growth-plan/:skill/complete",
  requireAuth,
  async (req, res) => {
    const userId = (req.session as { userId?: number }).userId;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const candidateId = await getMyCandidateId(userId);
    if (!candidateId) {
      res.status(403).json({ error: "Only candidates have a growth plan" });
      return;
    }

    const raw = String(req.params.skill ?? "");
    let skill: string;
    try {
      skill = decodeURIComponent(raw).toLowerCase();
    } catch {
      res.status(400).json({ error: "Malformed skill path parameter" });
      return;
    }
    if (!skill) {
      res.status(400).json({ error: "Missing skill" });
      return;
    }

    const parsed = CompleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid verificationUrl" });
      return;
    }

    const [row] = await db
      .select()
      .from(candidateGrowthSkillsTable)
      .where(
        and(
          eq(candidateGrowthSkillsTable.candidateId, candidateId),
          eq(candidateGrowthSkillsTable.skill, skill),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "Skill not in your growth plan" });
      return;
    }
    if (row.status === "dismissed") {
      res.status(409).json({ error: "Skill was dismissed" });
      return;
    }

    // Idempotent: only the first transition into "completed" fires the
    // re-ping. Subsequent /complete calls just return ok with no work.
    if (row.status === "completed") {
      res.json({ ok: true, employersNotified: 0 });
      return;
    }

    await db
      .update(candidateGrowthSkillsTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        verificationUrl: parsed.data.verificationUrl ?? row.verificationUrl,
      })
      .where(eq(candidateGrowthSkillsTable.id, row.id));

    // Best-effort re-ping.  Failure here must not 500 the route —
    // the candidate's "completed" UI state should still update.
    let employersNotified = 0;
    try {
      const result = await repingEmployersForCompletedSkill(candidateId, skill);
      employersNotified = result.employersNotified;
    } catch (err) {
      req.log.warn({ err, candidateId, skill }, "growth-plan: reping failed");
    }

    res.json({ ok: true, employersNotified });
  },
);

router.post(
  "/me/growth-plan/:skill/dismiss",
  requireAuth,
  async (req, res) => {
    const userId = (req.session as { userId?: number }).userId;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const candidateId = await getMyCandidateId(userId);
    if (!candidateId) {
      res.status(403).json({ error: "Only candidates have a growth plan" });
      return;
    }
    const raw = String(req.params.skill ?? "");
    let skill: string;
    try {
      skill = decodeURIComponent(raw).toLowerCase();
    } catch {
      res.status(400).json({ error: "Malformed skill path parameter" });
      return;
    }
    if (!skill) {
      res.status(400).json({ error: "Missing skill" });
      return;
    }

    const [row] = await db
      .select()
      .from(candidateGrowthSkillsTable)
      .where(
        and(
          eq(candidateGrowthSkillsTable.candidateId, candidateId),
          eq(candidateGrowthSkillsTable.skill, skill),
        ),
      );
    if (!row) {
      // Idempotent: dismissing something not in the plan inserts a
      // dismissed marker so the analyser won't re-add it later.
      // ON CONFLICT DO NOTHING so two concurrent dismisses don't 500
      // on the unique (candidateId, skill) constraint.
      await db
        .insert(candidateGrowthSkillsTable)
        .values({
          candidateId,
          skill,
          status: "dismissed",
          dismissedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [
            candidateGrowthSkillsTable.candidateId,
            candidateGrowthSkillsTable.skill,
          ],
        });
      res.json({ ok: true });
      return;
    }

    await db
      .update(candidateGrowthSkillsTable)
      .set({ status: "dismissed", dismissedAt: new Date() })
      .where(eq(candidateGrowthSkillsTable.id, row.id));
    res.json({ ok: true });
  },
);

/**
 * POST /me/growth-plan/:skill/add — manually add a skill to the plan.
 *
 * Surfaced from the Career Constellation graph's "Add to growth plan"
 * button so candidates can self-direct their plan without waiting for
 * the rejection-driven analyser. Idempotent: a re-add of an active
 * skill is a no-op; re-adding a dismissed/completed skill flips it
 * back to active.
 */
router.post("/me/growth-plan/:skill/add", requireAuth, async (req, res) => {
  const userId = (req.session as { userId?: number }).userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const candidateId = await getMyCandidateId(userId);
  if (!candidateId) {
    res.status(403).json({ error: "Only candidates have a growth plan" });
    return;
  }
  // Express already URL-decodes path params, so trust req.params.skill
  // directly and just normalize/bound it.
  const skill = String(req.params.skill ?? "").trim().toLowerCase();
  if (!skill || skill.length > 80) {
    res.status(400).json({ error: "Invalid skill" });
    return;
  }

  await db
    .insert(candidateGrowthSkillsTable)
    .values({ candidateId, skill, status: "active" })
    .onConflictDoUpdate({
      target: [
        candidateGrowthSkillsTable.candidateId,
        candidateGrowthSkillsTable.skill,
      ],
      set: { status: "active", dismissedAt: null, completedAt: null },
    });

  // Skills set isn't changing here, but the candidate's gap profile
  // is — clear the cache so the constellation re-fetches fresh.
  invalidateConstellationCache(candidateId);
  res.json({ ok: true });
});

export default router;
