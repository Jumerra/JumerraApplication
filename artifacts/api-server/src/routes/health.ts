import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { isEmailConfigured } from "../lib/email";
import { isPaystackConfigured } from "../lib/payment-rail";

const router: IRouter = Router();

/**
 * Liveness probe. Returns 200 once the process is up — no external
 * dependencies are touched, so an unhealthy database does not cause
 * the orchestrator to restart the pod.
 */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Readiness probe. Verifies that the process can actually serve
 * traffic: a one-shot DB ping plus a quick check that the
 * payment-rail clients can construct (i.e. their required env vars
 * are present). Returns 503 with a per-check breakdown when anything
 * is degraded so a load balancer can de-pool the instance without
 * tearing it down.
 */
router.get("/readyz", async (req, res) => {
  const checks: Record<string, "ok" | "fail" | "skipped"> = {};
  let dbErr: string | null = null;
  try {
    await db.execute(sql`select 1`);
    checks.database = "ok";
  } catch (err) {
    checks.database = "fail";
    dbErr = err instanceof Error ? err.message : String(err);
    req.log.warn({ err }, "readyz: database check failed");
  }

  // Stripe is required when STRIPE_SECRET_KEY is set; Paystack is
  // additive. We don't require both — just record which rails are
  // configured so the operator can spot a half-configured env.
  checks.stripe = process.env.STRIPE_SECRET_KEY ? "ok" : "skipped";
  checks.paystack = isPaystackConfigured() ? "ok" : "skipped";
  checks.email = isEmailConfigured() ? "ok" : "skipped";

  const failed = Object.entries(checks)
    .filter(([, v]) => v === "fail")
    .map(([k]) => k);
  if (failed.length > 0) {
    res.status(503).json({ status: "degraded", checks, error: dbErr });
    return;
  }
  res.json({ status: "ok", checks });
});

export default router;
