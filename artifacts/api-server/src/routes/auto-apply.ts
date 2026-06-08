import { Router } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import {
  db,
  autoApplySettingsTable,
  autoApplySubscriptionsTable,
  autoApplyLogTable,
  candidatesTable,
  jobsTable,
  usersTable,
  applicationsTable,
  applicationStatusHistoryTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import {
  requirePermission,
  isImplicitAllUser,
  getUserPermissions,
} from "../lib/permissions";
import {
  getUncachableStripeClient,
  mapStripeCheckoutError,
} from "../stripeClient";
import { selectPaymentRail, type PaymentRail } from "../lib/payment-rail";
import {
  paystackInitializeTransaction,
  paystackVerifyTransaction,
} from "../paystackClient";
import {
  finalizeAutoApplySubscriptionFromPaystack,
  finalizeAutoApplySubscriptionFromStripe,
} from "../lib/payment-finalizers";
import {
  loadOrSeedAutoApplySettings,
  loadCurrentAutoApplySubscription,
  subscriptionUnlocksAutoApply,
  type AutoApplySettingsRow,
  type AutoApplySubscriptionRow,
} from "../lib/auto-apply";

const router: Router = Router();

const ALLOWED_CURRENCIES = new Set([
  "usd",
  "eur",
  "gbp",
  "ngn",
  "ghs",
  "kes",
  "zar",
]);

/**
 * Mirror the Stripe-style `successUrl` sanitiser used by boost: Paystack
 * appends `?reference=...&trxref=...` to whatever callback URL we hand it, so
 * strip the Stripe `session_id` placeholder before forwarding.
 */
function sanitizePaystackCallbackUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.delete("session_id");
    return u.toString().replace(/\?$/, "");
  } catch {
    return raw;
  }
}

function toApiSettings(row: AutoApplySettingsRow) {
  return {
    isActive: row.isActive,
    priceCents: row.priceCents,
    currency: row.currency,
    intervalDays: row.intervalDays,
    matchThreshold: row.matchThreshold,
    dailyCap: row.dailyCap,
  };
}

function toApiSubscription(row: AutoApplySubscriptionRow | null) {
  if (!row) return null;
  return {
    status: row.status,
    provider: row.provider,
    currentPeriodEnd: row.currentPeriodEnd
      ? row.currentPeriodEnd.toISOString()
      : null,
    priceCents: row.priceCentsSnapshot,
    currency: row.currencySnapshot,
    intervalDays: row.intervalDaysSnapshot,
  };
}

/**
 * A candidate may always act on their own auto-apply record. An admin may act
 * on any candidate's record ONLY if they hold the `auto-apply:manage`
 * permission (super_admin has it implicitly); a bare admin sub-role without
 * that grant is denied, matching least-privilege expectations for the rest of
 * the admin console. No other role is allowed.
 */
async function resolveCandidateAccess(
  user: NonNullable<Express.Request["currentUser"]>,
  candidateId: number,
): Promise<{ allowed: boolean }> {
  if (user.role === "candidate") {
    return { allowed: user.candidateId === candidateId };
  }
  if (user.role === "admin") {
    if (isImplicitAllUser(user)) return { allowed: true };
    const perms = await getUserPermissions(user);
    return { allowed: perms.has("auto-apply:manage") };
  }
  return { allowed: false };
}

async function countAutoAppliesLast24h(candidateId: number): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(autoApplyLogTable)
    .where(
      and(
        eq(autoApplyLogTable.candidateId, candidateId),
        gt(autoApplyLogTable.createdAt, since),
      ),
    );
  return rows[0]?.count ?? 0;
}

/**
 * GET /api/auto-apply/settings
 * Auth required. Read-only view of the public-facing config (price, threshold,
 * cap, active flag) so candidate + admin UIs can decide what to render.
 */
router.get("/auto-apply/settings", requireAuth, async (_req, res) => {
  const row = await loadOrSeedAutoApplySettings();
  res.json(toApiSettings(row));
});

/**
 * PUT /api/admin/auto-apply/settings
 * Requires the `auto-apply:manage` permission (super_admin has it implicitly).
 * Updates the singleton config row, including the global on/off switch.
 */
router.put(
  "/admin/auto-apply/settings",
  requireAuth,
  requirePermission("auto-apply:manage"),
  async (req, res) => {
    try {
      const body = req.body as {
        isActive?: unknown;
        priceCents?: unknown;
        currency?: unknown;
        intervalDays?: unknown;
        matchThreshold?: unknown;
        dailyCap?: unknown;
      } | null;
      if (!body) {
        res.status(400).json({ error: "Request body required" });
        return;
      }
      const { isActive, priceCents, currency, intervalDays, matchThreshold, dailyCap } =
        body;

      if (typeof isActive !== "boolean") {
        res.status(400).json({ error: "isActive must be boolean" });
        return;
      }
      if (
        typeof priceCents !== "number" ||
        !Number.isInteger(priceCents) ||
        priceCents < 50 ||
        priceCents > 1_000_000
      ) {
        res
          .status(400)
          .json({ error: "priceCents must be an integer between 50 and 1000000" });
        return;
      }
      if (typeof currency !== "string") {
        res.status(400).json({ error: "currency must be a string" });
        return;
      }
      const normalizedCurrency = currency.toLowerCase();
      if (!ALLOWED_CURRENCIES.has(normalizedCurrency)) {
        res.status(400).json({
          error: `currency must be one of: ${Array.from(ALLOWED_CURRENCIES).join(", ")}`,
        });
        return;
      }
      if (
        typeof intervalDays !== "number" ||
        !Number.isInteger(intervalDays) ||
        intervalDays < 1 ||
        intervalDays > 365
      ) {
        res
          .status(400)
          .json({ error: "intervalDays must be an integer between 1 and 365" });
        return;
      }
      if (
        typeof matchThreshold !== "number" ||
        !Number.isInteger(matchThreshold) ||
        matchThreshold < 1 ||
        matchThreshold > 100
      ) {
        res
          .status(400)
          .json({ error: "matchThreshold must be an integer between 1 and 100" });
        return;
      }
      if (
        typeof dailyCap !== "number" ||
        !Number.isInteger(dailyCap) ||
        dailyCap < 1 ||
        dailyCap > 100
      ) {
        res
          .status(400)
          .json({ error: "dailyCap must be an integer between 1 and 100" });
        return;
      }

      await loadOrSeedAutoApplySettings();
      const updated = await db
        .update(autoApplySettingsTable)
        .set({
          isActive,
          priceCents,
          currency: normalizedCurrency,
          intervalDays,
          matchThreshold,
          dailyCap,
          updatedAt: new Date(),
          updatedBy: req.currentUser!.id,
        })
        .where(eq(autoApplySettingsTable.id, 1))
        .returning();
      if (!updated[0]) {
        res.status(500).json({ error: "Failed to update auto-apply settings" });
        return;
      }
      res.json(toApiSettings(updated[0]));
    } catch (err) {
      req.log.error({ err }, "auto-apply settings update failed");
      res.status(500).json({ error: "Update failed" });
    }
  },
);

/**
 * GET /api/candidates/:id/auto-apply/status
 * Auth required (owner candidate or admin). Returns the candidate's toggle, the
 * current subscription state, today's usage against the cap, and an `eligible`
 * flag that is true only when the global switch + toggle + active sub all line
 * up (i.e. the engine will actually act).
 */
router.get(
  "/candidates/:id/auto-apply/status",
  requireAuth,
  async (req, res) => {
    const candidateId = Number(req.params.id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }
    const { allowed } = await resolveCandidateAccess(req.currentUser!, candidateId);
    if (!allowed) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const candRows = await db
      .select({ autoApplyEnabled: candidatesTable.autoApplyEnabled })
      .from(candidatesTable)
      .where(eq(candidatesTable.id, candidateId))
      .limit(1);
    if (!candRows[0]) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    const settings = await loadOrSeedAutoApplySettings();
    const sub = await loadCurrentAutoApplySubscription(candidateId);
    const subscriptionActive = subscriptionUnlocksAutoApply(sub);
    const enabled = candRows[0].autoApplyEnabled;
    const usedToday = await countAutoAppliesLast24h(candidateId);
    res.json({
      settings: toApiSettings(settings),
      enabled,
      subscription: toApiSubscription(sub),
      subscriptionActive,
      eligible: settings.isActive && enabled && subscriptionActive,
      usedToday,
      dailyCap: settings.dailyCap,
    });
  },
);

/**
 * PUT /api/candidates/:id/auto-apply/toggle
 * Auth required (owner candidate or admin). Flips the candidate's opt-in. The
 * toggle is independent of payment — the engine still requires an active
 * subscription, so turning it on without a subscription is a no-op until they
 * pay (the UI surfaces this).
 */
router.put(
  "/candidates/:id/auto-apply/toggle",
  requireAuth,
  async (req, res) => {
    const candidateId = Number(req.params.id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }
    const { allowed } = await resolveCandidateAccess(req.currentUser!, candidateId);
    if (!allowed) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const body = (req.body ?? {}) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be boolean" });
      return;
    }
    const updated = await db
      .update(candidatesTable)
      .set({ autoApplyEnabled: body.enabled })
      .where(eq(candidatesTable.id, candidateId))
      .returning({ id: candidatesTable.id });
    if (!updated[0]) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json({ enabled: body.enabled });
  },
);

/**
 * POST /api/candidates/:id/auto-apply/checkout
 * Auth required (owner candidate or admin). Starts a subscription checkout for
 * the Auto-Apply feature. Refuses when the global switch is off. Routes through
 * the shared rail selector (Paystack-primary).
 */
router.post(
  "/candidates/:id/auto-apply/checkout",
  requireAuth,
  async (req, res) => {
    try {
      const candidateId = Number(req.params.id);
      if (!Number.isInteger(candidateId) || candidateId <= 0) {
        res.status(400).json({ error: "Invalid candidate id" });
        return;
      }
      const { allowed } = await resolveCandidateAccess(req.currentUser!, candidateId);
      if (!allowed) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }

      const body = (req.body ?? {}) as {
        successUrl?: unknown;
        cancelUrl?: unknown;
        rail?: unknown;
      };
      const successUrl = body.successUrl;
      const cancelUrl = body.cancelUrl;
      if (typeof successUrl !== "string" || !/^https?:\/\//.test(successUrl)) {
        res.status(400).json({ error: "successUrl must be an absolute URL" });
        return;
      }
      if (typeof cancelUrl !== "string" || !/^https?:\/\//.test(cancelUrl)) {
        res.status(400).json({ error: "cancelUrl must be an absolute URL" });
        return;
      }

      const settings = await loadOrSeedAutoApplySettings();
      if (!settings.isActive) {
        res.status(400).json({ error: "AI Auto-Apply is currently disabled" });
        return;
      }

      // Already covered? Don't let them pay twice.
      const currentSub = await loadCurrentAutoApplySubscription(candidateId);
      if (subscriptionUnlocksAutoApply(currentSub)) {
        res.status(409).json({
          error: "This candidate already has an active Auto-Apply subscription.",
          code: "already_subscribed",
        });
        return;
      }

      const candRows = await db
        .select({
          id: candidatesTable.id,
          fullName: candidatesTable.fullName,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.id, candidateId))
        .limit(1);
      const candidate = candRows[0];
      if (!candidate) {
        res.status(404).json({ error: "Candidate not found" });
        return;
      }

      const railOverride =
        typeof body.rail === "string" ? (body.rail as PaymentRail) : null;
      const rail = selectPaymentRail({
        currency: settings.currency,
        override: railOverride,
      });

      if (rail === "paystack") {
        const u = await db
          .select({ email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.candidateId, candidateId))
          .limit(1);
        const email = u[0]?.email ?? null;
        if (!email) {
          res.status(400).json({
            error:
              "Paystack checkout requires a candidate email; add an email to the account first.",
            code: "paystack_email_missing",
          });
          return;
        }
        try {
          const init = await paystackInitializeTransaction({
            email,
            amountSubunits: settings.priceCents,
            currency: settings.currency,
            callbackUrl: sanitizePaystackCallbackUrl(successUrl),
            metadata: {
              candidateId,
              purpose: "auto_apply_subscription",
              intervalDays: settings.intervalDays,
            },
          });
          await db.insert(autoApplySubscriptionsTable).values({
            candidateId,
            stripeCheckoutSessionId: init.reference,
            provider: "paystack",
            paystackReference: init.reference,
            priceCentsSnapshot: settings.priceCents,
            currencySnapshot: settings.currency,
            intervalDaysSnapshot: settings.intervalDays,
            status: "pending",
          });
          res.json({
            sessionId: init.reference,
            checkoutUrl: init.authorization_url,
            provider: "paystack",
          });
          return;
        } catch (paystackErr) {
          req.log.error(
            { err: paystackErr, candidateId, purpose: "auto_apply_subscription" },
            "auto-apply checkout: paystack init failed",
          );
          res.status(502).json({
            error:
              "Could not start Paystack checkout. Please try again in a moment.",
            code: "paystack_init_failed",
          });
          return;
        }
      }

      // Stripe rail (recurring subscription) — retained for parity.
      let session;
      try {
        const stripe = await getUncachableStripeClient();
        session = await stripe.checkout.sessions.create({
          mode: "subscription",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: settings.currency,
                unit_amount: settings.priceCents,
                recurring: { interval: "month" },
                product_data: {
                  name: "AI Auto-Apply",
                  description: `Automatically apply ${candidate.fullName} to strongly-matching jobs.`,
                },
              },
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            candidateId: String(candidateId),
            purpose: "auto_apply_subscription",
          },
        });
      } catch (stripeErr) {
        const mapped = mapStripeCheckoutError(stripeErr);
        req.log.error(
          {
            err: stripeErr,
            candidateId,
            purpose: "auto_apply_subscription",
            ...mapped.logFields,
          },
          "auto-apply checkout: stripe call failed",
        );
        res.status(mapped.status).json(mapped.body);
        return;
      }

      if (!session.url) {
        res.status(502).json({
          error:
            "Stripe didn't return a checkout URL. Please try again or contact support.",
          code: "stripe_no_url",
        });
        return;
      }

      await db.insert(autoApplySubscriptionsTable).values({
        candidateId,
        stripeCheckoutSessionId: session.id,
        provider: "stripe",
        priceCentsSnapshot: settings.priceCents,
        currencySnapshot: settings.currency,
        intervalDaysSnapshot: settings.intervalDays,
        status: "pending",
      });

      res.json({
        sessionId: session.id,
        checkoutUrl: session.url,
        provider: "stripe",
      });
    } catch (err) {
      req.log.error({ err }, "auto-apply checkout: unexpected failure");
      res.status(500).json({
        error:
          "An unexpected error occurred while creating the checkout session.",
        code: "internal_error",
      });
    }
  },
);

/**
 * POST /api/auto-apply/checkout/verify
 * Auth required. Re-checks a checkout with the provider and finalizes on
 * success via the shared transactional finalizer. Accepts `sessionId` (Stripe)
 * OR `reference` (Paystack). Idempotent.
 */
router.post("/auto-apply/checkout/verify", requireAuth, async (req, res) => {
  const body = (req.body ?? {}) as {
    sessionId?: unknown;
    reference?: unknown;
  };
  const sessionId = body.sessionId;
  const reference = body.reference;
  const externalRef =
    typeof sessionId === "string" && sessionId.length > 0
      ? sessionId
      : typeof reference === "string" && reference.length > 0
        ? reference
        : null;
  if (!externalRef) {
    res.status(400).json({ error: "sessionId or reference required" });
    return;
  }
  let paymentCandidateId: number | null = null;
  try {
    const rows = await db
      .select()
      .from(autoApplySubscriptionsTable)
      .where(eq(autoApplySubscriptionsTable.stripeCheckoutSessionId, externalRef))
      .limit(1);
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    paymentCandidateId = row.candidateId;

    const { allowed } = await resolveCandidateAccess(
      req.currentUser!,
      row.candidateId,
    );
    if (!allowed) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    if (row.status === "active" || row.status === "trialing") {
      res.json({
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd
          ? row.currentPeriodEnd.toISOString()
          : null,
      });
      return;
    }
    if (row.status === "failed" || row.status === "expired" || row.status === "canceled") {
      res.json({ status: row.status, currentPeriodEnd: null });
      return;
    }

    if (row.provider === "paystack") {
      const ref = row.paystackReference ?? externalRef;
      try {
        const verifyResp = await paystackVerifyTransaction(ref);
        const psStatus = verifyResp.status ?? null;
        if (psStatus === "success") {
          const result = await finalizeAutoApplySubscriptionFromPaystack(ref);
          const reread = await db
            .select({ currentPeriodEnd: autoApplySubscriptionsTable.currentPeriodEnd })
            .from(autoApplySubscriptionsTable)
            .where(eq(autoApplySubscriptionsTable.id, row.id))
            .limit(1);
          res.json({
            status: "active",
            currentPeriodEnd: reread[0]?.currentPeriodEnd
              ? reread[0].currentPeriodEnd.toISOString()
              : null,
            alreadyFinalized: result.alreadyFinalized,
          });
          return;
        }
        if (psStatus === "failed" || psStatus === "abandoned") {
          await db
            .update(autoApplySubscriptionsTable)
            .set({ status: "failed", updatedAt: new Date() })
            .where(
              and(
                eq(autoApplySubscriptionsTable.id, row.id),
                eq(autoApplySubscriptionsTable.status, "pending"),
              ),
            );
          res.json({ status: "failed", currentPeriodEnd: null });
          return;
        }
        res.json({ status: "pending", currentPeriodEnd: null });
        return;
      } catch (paystackErr) {
        req.log.error(
          { err: paystackErr, ref, candidateId: paymentCandidateId },
          "auto-apply verify: paystack verify failed",
        );
        res.status(502).json({
          error: "Could not verify Paystack payment. Please try again.",
          code: "paystack_verify_failed",
        });
        return;
      }
    }

    // Stripe rail.
    const result = await finalizeAutoApplySubscriptionFromStripe(externalRef);
    const reread = await db
      .select({
        status: autoApplySubscriptionsTable.status,
        currentPeriodEnd: autoApplySubscriptionsTable.currentPeriodEnd,
      })
      .from(autoApplySubscriptionsTable)
      .where(eq(autoApplySubscriptionsTable.id, row.id))
      .limit(1);
    res.json({
      status: reread[0]?.status ?? "pending",
      currentPeriodEnd: reread[0]?.currentPeriodEnd
        ? reread[0].currentPeriodEnd.toISOString()
        : null,
      alreadyFinalized: result.alreadyFinalized,
    });
  } catch (err) {
    const mapped = mapStripeCheckoutError(err);
    req.log.error(
      {
        err,
        sessionId,
        candidateId: paymentCandidateId ?? req.currentUser?.candidateId ?? null,
        purpose: "auto_apply_subscription",
        errCode: mapped.body.code,
        ...mapped.logFields,
      },
      "auto-apply checkout verify failed",
    );
    res.status(mapped.status).json(mapped.body);
  }
});

/**
 * GET /api/candidates/:id/auto-apply/activity
 * Auth required (owner candidate or admin). Recent auto-submitted applications
 * for the candidate, newest first, joined to the job for display.
 */
router.get(
  "/candidates/:id/auto-apply/activity",
  requireAuth,
  async (req, res) => {
    const candidateId = Number(req.params.id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }
    const { allowed } = await resolveCandidateAccess(req.currentUser!, candidateId);
    if (!allowed) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const rows = await db
      .select({
        id: autoApplyLogTable.id,
        jobId: autoApplyLogTable.jobId,
        applicationId: autoApplyLogTable.applicationId,
        matchScore: autoApplyLogTable.matchScore,
        createdAt: autoApplyLogTable.createdAt,
        jobTitle: jobsTable.title,
        applicationStatus: applicationsTable.status,
      })
      .from(autoApplyLogTable)
      .leftJoin(jobsTable, eq(jobsTable.id, autoApplyLogTable.jobId))
      .leftJoin(
        applicationsTable,
        eq(applicationsTable.id, autoApplyLogTable.applicationId),
      )
      .where(eq(autoApplyLogTable.candidateId, candidateId))
      .orderBy(desc(autoApplyLogTable.createdAt))
      .limit(50);
    res.json(
      rows.map((r) => ({
        id: r.id,
        jobId: r.jobId,
        applicationId: r.applicationId,
        matchScore: r.matchScore,
        jobTitle: r.jobTitle ?? "(job removed)",
        createdAt: r.createdAt.toISOString(),
        applicationStatus: r.applicationStatus ?? null,
      })),
    );
  },
);

/**
 * POST /api/candidates/:id/auto-apply/activity/:logId/withdraw
 * Auth required (owner candidate or admin). Marks the application that
 * Auto-Apply submitted for this activity row as `withdrawn` and appends a
 * status-history row, mirroring the employer PATCH path. Idempotent: an
 * already-withdrawn application returns the current row.
 *
 * Withdrawing does NOT re-trigger Auto-Apply for the same job: the application
 * row and the auto_apply_log row both remain, so `attemptAutoApply`'s
 * applications-table dedupe (which matches on (candidate, job) regardless of
 * status) and the auto_apply_log UNIQUE(candidate, job) both still short-circuit
 * a re-submission.
 */
router.post(
  "/candidates/:id/auto-apply/activity/:logId/withdraw",
  requireAuth,
  async (req, res) => {
    const candidateId = Number(req.params.id);
    const logId = Number(req.params.logId);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }
    if (!Number.isInteger(logId) || logId <= 0) {
      res.status(400).json({ error: "Invalid activity id" });
      return;
    }
    const { allowed } = await resolveCandidateAccess(req.currentUser!, candidateId);
    if (!allowed) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    const logRows = await db
      .select({
        id: autoApplyLogTable.id,
        jobId: autoApplyLogTable.jobId,
        applicationId: autoApplyLogTable.applicationId,
        matchScore: autoApplyLogTable.matchScore,
        createdAt: autoApplyLogTable.createdAt,
      })
      .from(autoApplyLogTable)
      .where(
        and(
          eq(autoApplyLogTable.id, logId),
          eq(autoApplyLogTable.candidateId, candidateId),
        ),
      )
      .limit(1);
    const log = logRows[0];
    if (!log) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    if (log.applicationId == null) {
      res.status(400).json({ error: "This activity has no application to withdraw" });
      return;
    }

    const appRows = await db
      .select({
        id: applicationsTable.id,
        status: applicationsTable.status,
        candidateId: applicationsTable.candidateId,
      })
      .from(applicationsTable)
      .where(eq(applicationsTable.id, log.applicationId))
      .limit(1);
    const app = appRows[0];
    if (!app || app.candidateId !== candidateId) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const jobRows = await db
      .select({ title: jobsTable.title })
      .from(jobsTable)
      .where(eq(jobsTable.id, log.jobId))
      .limit(1);
    const jobTitle = jobRows[0]?.title ?? "(job removed)";

    const buildItem = (status: string) => ({
      id: log.id,
      jobId: log.jobId,
      applicationId: log.applicationId,
      matchScore: log.matchScore,
      jobTitle,
      createdAt: log.createdAt.toISOString(),
      applicationStatus: status,
    });

    // Idempotent: already withdrawn → return the current row unchanged.
    if (app.status === "withdrawn") {
      res.json(buildItem("withdrawn"));
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(applicationsTable)
        .set({ status: "withdrawn" })
        .where(eq(applicationsTable.id, app.id));
      await tx.insert(applicationStatusHistoryTable).values({
        applicationId: app.id,
        status: "withdrawn",
        changedBy: req.currentUser!.id,
      });
    });

    res.json(buildItem("withdrawn"));
  },
);

export default router;
