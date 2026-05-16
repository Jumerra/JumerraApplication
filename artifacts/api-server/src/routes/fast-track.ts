/**
 * Fast-Track Pledge endpoints (task #76).
 *
 *   GET  /me/employer/fast-track  → current state + streak + upcoming
 *                                   deadlines for the employer dashboard
 *   POST /me/employer/fast-track  → { enabled: boolean } toggle
 *
 * Both routes require an authenticated employer staff user with an
 * `employerId` on their session. Admins acting on behalf of a specific
 * employer can pass `?employerId=` (admin override).
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { getFastTrackState, toggleFastTrack } from "../lib/sla";

const router: IRouter = Router();

function resolveEmployerId(req: Request): number | null {
  const user = (req as Request & {
    currentUser?: { role: string; employerId?: number | null };
  }).currentUser;
  if (!user) return null;
  if (user.role === "employer" && user.employerId) return user.employerId;
  if (user.role === "admin") {
    const raw = req.query.employerId;
    if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  }
  return null;
}

router.get(
  "/me/employer/fast-track",
  requireAuth,
  async (req, res): Promise<void> => {
    const employerId = resolveEmployerId(req);
    if (!employerId) {
      res.status(403).json({ error: "Only employer staff may view this" });
      return;
    }
    try {
      const state = await getFastTrackState(employerId);
      res.json(state);
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "NOT_FOUND") {
        res.status(404).json({ error: "Employer not found" });
        return;
      }
      throw err;
    }
  },
);

const ToggleBody = z.object({ enabled: z.boolean() });

router.post(
  "/me/employer/fast-track",
  requireAuth,
  async (req, res): Promise<void> => {
    const employerId = resolveEmployerId(req);
    if (!employerId) {
      res.status(403).json({ error: "Only employer staff may change this" });
      return;
    }
    const parsed = ToggleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const state = await toggleFastTrack(employerId, parsed.data.enabled);
      res.json(state);
    } catch (err) {
      const code =
        err && typeof err === "object"
          ? (err as { code?: string }).code
          : undefined;
      if (code === "REVOKED") {
        res.status(409).json({
          error: "Fast-Track is in a cooldown period and cannot be re-enabled yet.",
        });
        return;
      }
      if (code === "NOT_FOUND") {
        res.status(404).json({ error: "Employer not found" });
        return;
      }
      throw err;
    }
  },
);

export default router;
