import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  employerSubscriptionSettingsTable,
  employerSubscriptionsTable,
  employersTable,
  jobsTable,
} from "@workspace/db";
import {
  requireAuth,
  requireAdmin,
} from "../middleware/require-auth";
import { getUncachableStripeClient } from "../stripeClient";

const router: Router = Router();

const SETTINGS_ROW_ID = 1;

const ALLOWED_CURRENCIES = new Set([
  "usd",
  "eur",
  "gbp",
  "ngn",
  "ghs",
  "kes",
  "zar",
]);

type SettingsRow = typeof employerSubscriptionSettingsTable.$inferSelect;
type SubRow = typeof employerSubscriptionsTable.$inferSelect;

function toApiSettings(row: SettingsRow) {
  return {
    isActive: row.isActive,
    freeJobPostLimit: row.freeJobPostLimit,
    priceCents: row.priceCents,
    currency: row.currency,
    intervalDays: row.intervalDays,
    trialDays: row.trialDays,
  };
}

async function loadOrSeedSettings(): Promise<SettingsRow> {
  const existing = await db
    .select()
    .from(employerSubscriptionSettingsTable)
    .where(eq(employerSubscriptionSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(employerSubscriptionSettingsTable)
    .values({ id: SETTINGS_ROW_ID })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(employerSubscriptionSettingsTable)
    .where(eq(employerSubscriptionSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (!reread[0]) {
    throw new Error("Failed to seed employer_subscription_settings row");
  }
  return reread[0];
}

/**
 * "Current" subscription for an employer. Same resolution rules as
 * institution-subscription: prefer the most recent row whose
 * Stripe-side state is still valid, otherwise the most recent of any
 * status.
 */
async function loadCurrentSubscription(
  employerId: number,
): Promise<SubRow | null> {
  const rows = await db
    .select()
    .from(employerSubscriptionsTable)
    .where(eq(employerSubscriptionsTable.employerId, employerId))
    .orderBy(desc(employerSubscriptionsTable.createdAt));
  if (rows.length === 0) return null;

  const now = Date.now();
  const valid = rows.find((r) => {
    if (r.status !== "trialing" && r.status !== "active") return false;
    const trialOk =
      r.status === "trialing" && r.trialEndsAt && r.trialEndsAt.getTime() > now;
    const periodOk =
      r.currentPeriodEnd && r.currentPeriodEnd.getTime() > now;
    return trialOk || periodOk;
  });
  return valid ?? rows[0];
}

async function findReusablePendingCheckout(
  employerId: number,
): Promise<SubRow | null> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(employerSubscriptionsTable)
    .where(
      and(
        eq(employerSubscriptionsTable.employerId, employerId),
        eq(employerSubscriptionsTable.status, "pending"),
      ),
    )
    .orderBy(desc(employerSubscriptionsTable.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.createdAt.getTime() < oneHourAgo.getTime()) return null;
  return row;
}

type StatusName =
  | "none"
  | "pending"
  | "trialing"
  | "active"
  | "expired"
  | "canceled"
  | "failed";

interface ApiStatus {
  status: StatusName;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  priceCentsSnapshot: number | null;
  currencySnapshot: string | null;
  isInTrial: boolean;
  hasActiveSubscription: boolean;
  freeJobPostLimit: number;
  jobsPostedCount: number;
  freeJobsRemaining: number;
  canPostJob: boolean;
  featureEnabled: boolean;
}

function rowToBaseStatus(row: SubRow | null): {
  status: StatusName;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  priceCentsSnapshot: number | null;
  currencySnapshot: string | null;
  isInTrial: boolean;
  hasActiveSubscription: boolean;
} {
  if (!row) {
    return {
      status: "none",
      trialEndsAt: null,
      currentPeriodEnd: null,
      priceCentsSnapshot: null,
      currencySnapshot: null,
      isInTrial: false,
      hasActiveSubscription: false,
    };
  }
  const now = Date.now();
  const trialEnd = row.trialEndsAt;
  const periodEnd = row.currentPeriodEnd;
  const inTrial = !!(trialEnd && trialEnd.getTime() > now);
  const inActivePeriod = !!(periodEnd && periodEnd.getTime() > now);

  let status: StatusName = (row.status as StatusName) ?? "none";
  if (status === "trialing" && !inTrial && !inActivePeriod) {
    status = "expired";
  }
  if (status === "active" && !inActivePeriod) {
    status = "expired";
  }

  const hasActive = status === "trialing" || status === "active";
  return {
    status,
    trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
    currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    priceCentsSnapshot: row.priceCentsSnapshot,
    currencySnapshot: row.currencySnapshot,
    isInTrial: inTrial,
    hasActiveSubscription: hasActive,
  };
}

async function countEmployerJobs(employerId: number): Promise<number> {
  const result = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(jobsTable)
    .where(eq(jobsTable.employerId, employerId));
  return Number(result[0]?.c ?? 0);
}

async function buildStatusForEmployer(
  employerId: number,
): Promise<ApiStatus> {
  const settings = await loadOrSeedSettings();
  const row = await loadCurrentSubscription(employerId);
  const base = rowToBaseStatus(row);
  const jobsPostedCount = await countEmployerJobs(employerId);
  const freeRemaining = Math.max(
    settings.freeJobPostLimit - jobsPostedCount,
    0,
  );
  // Allow posting when: feature disabled, OR under free quota, OR has
  // an active/trialing subscription.
  const canPost =
    !settings.isActive ||
    freeRemaining > 0 ||
    base.hasActiveSubscription;
  return {
    ...base,
    freeJobPostLimit: settings.freeJobPostLimit,
    jobsPostedCount,
    freeJobsRemaining: freeRemaining,
    canPostJob: canPost,
    featureEnabled: settings.isActive,
  };
}

/**
 * Public helper used by the jobs route to enforce the paywall on
 * POST /jobs. Returns the same shape as the GET endpoint so callers
 * can render the same paywall UI from the 402 response.
 */
export async function getEmployerPostingStatus(
  employerId: number,
): Promise<ApiStatus> {
  return buildStatusForEmployer(employerId);
}

// ---------------------------------------------------------------------------
// GET /api/employer-subscription/settings
// ---------------------------------------------------------------------------
router.get(
  "/employer-subscription/settings",
  requireAuth,
  async (_req, res) => {
    const row = await loadOrSeedSettings();
    res.json(toApiSettings(row));
  },
);

// ---------------------------------------------------------------------------
// PUT /api/admin/employer-subscription/settings
// ---------------------------------------------------------------------------
router.put(
  "/admin/employer-subscription/settings",
  requireAdmin,
  async (req, res) => {
    try {
      const body = req.body as {
        isActive?: unknown;
        freeJobPostLimit?: unknown;
        priceCents?: unknown;
        currency?: unknown;
        intervalDays?: unknown;
        trialDays?: unknown;
      } | null;
      if (!body) {
        res.status(400).json({ error: "Request body required" });
        return;
      }
      const {
        isActive,
        freeJobPostLimit,
        priceCents,
        currency,
        intervalDays,
        trialDays,
      } = body;

      if (typeof isActive !== "boolean") {
        res.status(400).json({ error: "isActive must be boolean" });
        return;
      }
      if (
        typeof freeJobPostLimit !== "number" ||
        !Number.isInteger(freeJobPostLimit) ||
        freeJobPostLimit < 0 ||
        freeJobPostLimit > 1000
      ) {
        res.status(400).json({
          error: "freeJobPostLimit must be an integer between 0 and 1000",
        });
        return;
      }
      if (
        typeof priceCents !== "number" ||
        !Number.isInteger(priceCents) ||
        priceCents < 50 ||
        priceCents > 10_000_000
      ) {
        res.status(400).json({
          error: "priceCents must be an integer between 50 and 10000000",
        });
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
        res.status(400).json({
          error: "intervalDays must be an integer between 1 and 365",
        });
        return;
      }
      if (
        typeof trialDays !== "number" ||
        !Number.isInteger(trialDays) ||
        trialDays < 0 ||
        trialDays > 365
      ) {
        res.status(400).json({
          error: "trialDays must be an integer between 0 and 365",
        });
        return;
      }

      await loadOrSeedSettings();
      const updated = await db
        .update(employerSubscriptionSettingsTable)
        .set({
          isActive,
          freeJobPostLimit,
          priceCents,
          currency: normalizedCurrency,
          intervalDays,
          trialDays,
          updatedAt: new Date(),
          updatedBy: req.currentUser!.id,
        })
        .where(eq(employerSubscriptionSettingsTable.id, SETTINGS_ROW_ID))
        .returning();
      if (!updated[0]) {
        res
          .status(500)
          .json({ error: "Failed to update employer subscription settings" });
        return;
      }
      res.json(toApiSettings(updated[0]));
    } catch (err) {
      req.log.error({ err }, "employer subscription settings update failed");
      res.status(500).json({ error: "Update failed" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/employers/:id/subscription
// ---------------------------------------------------------------------------
router.get(
  "/employers/:id/subscription",
  requireAuth,
  async (req, res) => {
    const employerId = Number(req.params.id);
    if (!Number.isInteger(employerId) || employerId <= 0) {
      res.status(400).json({ error: "Invalid employer id" });
      return;
    }
    const user = req.currentUser!;
    const isAdmin = user.role === "admin";
    const isMember =
      user.role === "employer" && user.employerId === employerId;
    if (!isAdmin && !isMember) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    const emp = await db
      .select({ id: employersTable.id })
      .from(employersTable)
      .where(eq(employersTable.id, employerId))
      .limit(1);
    if (!emp[0]) {
      res.status(404).json({ error: "Employer not found" });
      return;
    }

    const status = await buildStatusForEmployer(employerId);
    res.json(status);
  },
);

// ---------------------------------------------------------------------------
// POST /api/employers/:id/subscription/checkout
// ---------------------------------------------------------------------------
router.post(
  "/employers/:id/subscription/checkout",
  requireAuth,
  async (req, res) => {
    try {
      const employerId = Number(req.params.id);
      if (!Number.isInteger(employerId) || employerId <= 0) {
        res.status(400).json({ error: "Invalid employer id" });
        return;
      }
      const user = req.currentUser!;
      const isAdmin = user.role === "admin";
      const isOwner =
        user.role === "employer" &&
        user.employerId === employerId &&
        user.orgRole === "owner";
      if (!isAdmin && !isOwner) {
        res.status(403).json({
          error: "Only employer owners or platform admins can subscribe",
        });
        return;
      }

      const body = (req.body ?? {}) as {
        successUrl?: unknown;
        cancelUrl?: unknown;
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

      const settings = await loadOrSeedSettings();
      if (!settings.isActive) {
        res.status(400).json({
          error: "Employer subscriptions are currently disabled",
        });
        return;
      }

      const emp = await db
        .select({ id: employersTable.id, name: employersTable.name })
        .from(employersTable)
        .where(eq(employersTable.id, employerId))
        .limit(1);
      const employer = emp[0];
      if (!employer) {
        res.status(404).json({ error: "Employer not found" });
        return;
      }

      const existing = await loadCurrentSubscription(employerId);
      const existingBase = rowToBaseStatus(existing);
      if (existingBase.hasActiveSubscription) {
        res.status(400).json({
          error: "Employer already has an active subscription",
        });
        return;
      }

      const stripe = await getUncachableStripeClient();
      const reusable = await findReusablePendingCheckout(employerId);
      if (reusable) {
        try {
          const existingSession = await stripe.checkout.sessions.retrieve(
            reusable.stripeCheckoutSessionId,
          );
          if (
            existingSession.status === "open" &&
            existingSession.url
          ) {
            res.json({
              sessionId: existingSession.id,
              checkoutUrl: existingSession.url,
            });
            return;
          }
        } catch (retrieveErr) {
          req.log.warn(
            { err: retrieveErr, sessionId: reusable.stripeCheckoutSessionId },
            "could not retrieve pending session for reuse, creating new one",
          );
        }
      }

      // Map intervalDays -> Stripe recurring interval. We support
      // weekly / monthly / yearly; everything else falls back to a
      // day-based count.
      const recurring = (() => {
        if (settings.intervalDays === 7) {
          return { interval: "week" as const };
        }
        if (settings.intervalDays === 30) {
          return { interval: "month" as const };
        }
        if (settings.intervalDays === 365) {
          return { interval: "year" as const };
        }
        return {
          interval: "day" as const,
          interval_count: settings.intervalDays,
        };
      })();

      const checkout = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: settings.currency,
              unit_amount: settings.priceCents,
              recurring,
              product_data: {
                name: `${employer.name} — Job Posting Premium`,
                description: `Unlimited job posts for ${employer.name}.${
                  settings.trialDays > 0
                    ? ` Includes ${settings.trialDays}-day free trial.`
                    : ""
                }`,
              },
            },
          },
        ],
        subscription_data:
          settings.trialDays > 0
            ? { trial_period_days: settings.trialDays }
            : undefined,
        // Same trial/no-card behavior as institution-subscription.
        payment_method_collection:
          settings.trialDays > 0 ? "if_required" : "always",
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          employerId: String(employerId),
          purpose: "employer_subscription",
        },
      });

      if (!checkout.url) {
        res
          .status(500)
          .json({ error: "Stripe did not return a checkout URL" });
        return;
      }

      await db.insert(employerSubscriptionsTable).values({
        employerId,
        stripeCheckoutSessionId: checkout.id,
        status: "pending",
        priceCentsSnapshot: settings.priceCents,
        currencySnapshot: settings.currency,
        intervalDaysSnapshot: settings.intervalDays,
        trialDaysSnapshot: settings.trialDays,
      });

      res.json({ sessionId: checkout.id, checkoutUrl: checkout.url });
    } catch (err) {
      req.log.error(
        { err },
        "employer subscription checkout creation failed",
      );
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/employer-subscription/checkout/verify
// ---------------------------------------------------------------------------
router.post(
  "/employer-subscription/checkout/verify",
  requireAuth,
  async (req, res) => {
    try {
      const body = (req.body ?? {}) as { sessionId?: unknown };
      const sessionId = body.sessionId;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        res.status(400).json({ error: "sessionId required" });
        return;
      }

      const rows = await db
        .select()
        .from(employerSubscriptionsTable)
        .where(
          eq(
            employerSubscriptionsTable.stripeCheckoutSessionId,
            sessionId,
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const user = req.currentUser!;
      const isAdmin = user.role === "admin";
      const isMember =
        user.role === "employer" && user.employerId === row.employerId;
      if (!isAdmin && !isMember) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }

      if (
        row.status === "trialing" ||
        row.status === "active" ||
        row.status === "expired" ||
        row.status === "canceled" ||
        row.status === "failed"
      ) {
        const status = await buildStatusForEmployer(row.employerId);
        res.json(status);
        return;
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"],
      });

      const sub =
        typeof session.subscription === "object" && session.subscription
          ? (session.subscription as unknown as {
              id: string;
              status: string;
              trial_end: number | null;
              current_period_end?: number;
              customer: string | { id: string } | null;
              items?: {
                data?: Array<{ current_period_end?: number }>;
              };
            })
          : null;

      if (session.status === "expired") {
        await db
          .update(employerSubscriptionsTable)
          .set({ status: "expired", updatedAt: new Date() })
          .where(
            and(
              eq(employerSubscriptionsTable.id, row.id),
              eq(employerSubscriptionsTable.status, "pending"),
            ),
          );
        const status = await buildStatusForEmployer(row.employerId);
        res.json(status);
        return;
      }

      if (!sub) {
        const status = await buildStatusForEmployer(row.employerId);
        res.json(status);
        return;
      }

      const customerId =
        typeof sub.customer === "string"
          ? sub.customer
          : sub.customer?.id ?? null;

      let mapped: "trialing" | "active" | "canceled" | "expired" | "failed" =
        "failed";
      if (sub.status === "trialing") mapped = "trialing";
      else if (sub.status === "active") mapped = "active";
      else if (sub.status === "canceled") mapped = "canceled";
      else if (
        sub.status === "incomplete_expired" ||
        sub.status === "unpaid"
      ) {
        mapped = "expired";
      } else if (sub.status === "past_due" || sub.status === "paused") {
        mapped = "expired";
      } else if (sub.status === "incomplete") {
        const status = await buildStatusForEmployer(row.employerId);
        res.json(status);
        return;
      }

      const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
      const periodEndUnix =
        sub.current_period_end ??
        sub.items?.data?.[0]?.current_period_end ??
        null;
      if (!periodEndUnix) {
        const status = await buildStatusForEmployer(row.employerId);
        res.json(status);
        return;
      }
      const currentPeriodEnd = new Date(periodEndUnix * 1000);

      await db
        .update(employerSubscriptionsTable)
        .set({
          status: mapped,
          stripeSubscriptionId: sub.id,
          stripeCustomerId: customerId,
          trialEndsAt,
          currentPeriodEnd,
          startedAt: row.startedAt ?? new Date(),
          updatedAt: new Date(),
          ...(mapped === "canceled" ? { canceledAt: new Date() } : {}),
        })
        .where(eq(employerSubscriptionsTable.id, row.id));

      const status = await buildStatusForEmployer(row.employerId);
      res.json(status);
    } catch (err) {
      req.log.error({ err }, "employer subscription verify failed");
      res.status(500).json({ error: "Verification failed" });
    }
  },
);

export default router;
