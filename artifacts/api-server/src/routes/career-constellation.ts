/**
 * Career constellation API. Task #78.
 *
 *   GET /me/career-constellation
 *     → roles aggregated by title with the candidate's missing-skill
 *       distance, used by the dashboard graph + mobile list.
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { buildCareerConstellation } from "../lib/career-constellation";

const router: IRouter = Router();

router.get("/me/career-constellation", requireAuth, async (req, res) => {
  const userId = (req.session as { userId?: number }).userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [row] = await db
    .select({ candidateId: usersTable.candidateId })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const candidateId = row?.candidateId ?? null;
  if (!candidateId) {
    res
      .status(403)
      .json({ error: "Only candidates have a career constellation" });
    return;
  }

  try {
    const value = await buildCareerConstellation(candidateId);
    res.json(value);
  } catch (err) {
    req.log.error({ err, candidateId }, "career-constellation: build failed");
    res.status(500).json({ error: "Failed to build career constellation" });
  }
});

export default router;
