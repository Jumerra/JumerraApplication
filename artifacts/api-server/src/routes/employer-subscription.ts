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

/**
 * Mark every response from this router as deprecated. Recurring
 * employer subscriptions are being phased out in favor of one-shot
 * per-job tiers (Free / Promoted / Sponsored). Endpoints still
 * function so existing UI stays usable while we migrate.
 */
router.use((_req, res, next) => {
  res.setHeader("Deprecation", "true");
  res.setHeader(
    "Link",
    '</api/job-tier-settings>; rel="successor-version", </api/admin/job-tier-settings>; rel="successor-version"',
  );
  res.setHeader(
    "Warning",
    '299 - "Recurring employer subscriptions are deprecated; switch to per-job tiers."',
  );
  next();
});

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

/**
 * Count of paid (non-internship) jobs an employer has posted. Internships
 * are ALWAYS free and never consume the free-quota or require a
 * subscription, so they are excluded from this count.
 */
async function countEmployerPaidJobs(employerId: number): Promise<number> {
  const result = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.employerId, employerId),
        sql`${jobsTable.type} <> 'internship'`,
      ),
    );
  return Number(result[0]?.c ?? 0);
}

async function buildStatusForEmployer(
  employerId: number,
): Promise<ApiStatus> {
  const settings = await loadOrSeedSettings();
  const row = await loadCurrentSubscription(employerId);
  const base = rowToBaseStatus(row);
  // Only count paid (non-internship) jobs against the free quota.
  // Internships are always free and never consume the quota.
  const jobsPostedCount = await countEmployerPaidJobs(employerId);
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
/**
 * DEPRECATED — kept only to preserve old client compatibility. The
 * platform no longer sells recurring employer subscriptions; pricing
 * has moved to per-job one-shot tiers (Free / Promoted / Sponsored).
 *
 * We deliberately do NOT call Stripe here, do not create any new
 * subscription rows, and do not return a checkoutUrl. Old clients
 * receive HTTP 410 with a stable deprecated payload so they can
 * surface the migration message instead of looping on a broken flow.
 */
router.post(
  "/employers/:id/subscription/checkout",
  requireAuth,
  async (_req, res): Promise<void> => {
    res.status(410).json({
      error:
        "Recurring employer subscriptions have been retired. All job posts are now free; upgrade individual jobs to Promoted or Sponsored from the job page.",
      deprecated: true,
      replacement: "POST /jobs/:id/promote/checkout",
      sessionId: null,
      checkoutUrl: null,
    });
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

/**
 * Tells the current employer's dashboard whether their recurring
 * subscription is in the legacy-cancellation cohort. Drives the
 * deprecation banner: shown only if there's a legacy subscription
 * (or it has been migrated). Employers without any subscription get
 * `hasLegacySubscription: false` and won't see the banner.
 */
router.get(
  "/employer-subscription/legacy-status",
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const user = req.currentUser!;
      if (user.role !== "employer" || !user.employerId) {
        res.json({
          hasLegacySubscription: false,
          migratedAt: null,
          currentPeriodEnd: null,
        });
        return;
      }
      const sub = await loadCurrentSubscription(user.employerId);
      const [employer] = await db
        .select({
          legacySubscriptionMigratedAt:
            employersTable.legacySubscriptionMigratedAt,
        })
        .from(employersTable)
        .where(eq(employersTable.id, user.employerId))
        .limit(1);
      const hasLegacy =
        !!sub &&
        (sub.status === "active" ||
          sub.status === "trialing" ||
          (!!employer?.legacySubscriptionMigratedAt));
      res.json({
        hasLegacySubscription: hasLegacy,
        migratedAt:
          employer?.legacySubscriptionMigratedAt
            ? employer.legacySubscriptionMigratedAt.toISOString()
            : null,
        currentPeriodEnd: sub?.currentPeriodEnd
          ? sub.currentPeriodEnd.toISOString()
          : null,
      });
    } catch (err) {
      req.log.error({ err }, "legacy-status lookup failed");
      res.status(500).json({ error: "Lookup failed" });
    }
  },
);

/**
 * One-shot admin migration: for every employer with an active or
 * trialing recurring subscription, call Stripe to set
 * `cancel_at_period_end=true` and stamp the employer with
 * `legacySubscriptionMigratedAt`. Idempotent: an employer already
 * migrated, or whose Stripe subscription is missing/already
 * cancelling, is counted as `skipped`.
 */
router.post(
  "/admin/employer-subscription/migrate-legacy",
  requireAdmin,
  async (req, res): Promise<void> => {
    const summary = { scanned: 0, cancelled: 0, skipped: 0, failed: 0 };
    try {
      // Order deterministically newest-first so the per-employer
      // dedupe below always operates on the most recent active row,
      // not an arbitrary one. We then skip older rows for the same
      // employer instead of acting twice.
      const subs = await db
        .select()
        .from(employerSubscriptionsTable)
        .where(
          sql`${employerSubscriptionsTable.status} IN ('active','trialing')`,
        )
        .orderBy(
          desc(employerSubscriptionsTable.createdAt),
          desc(employerSubscriptionsTable.id),
        );
      summary.scanned = subs.length;

      let stripe: Awaited<ReturnType<typeof getUncachableStripeClient>> | null =
        null;
      try {
        stripe = await getUncachableStripeClient();
      } catch (err) {
        req.log.error({ err }, "migrate-legacy: stripe client unavailable");
        res.status(503).json({ ...summary, error: "Stripe unavailable" });
        return;
      }

      // Group by employer; only operate on the most-recent active sub
      // per employer (loadCurrentSubscription semantics).
      const seenEmployer = new Set<number>();
      for (const sub of subs) {
        if (seenEmployer.has(sub.employerId)) {
          summary.skipped += 1;
          continue;
        }
        seenEmployer.add(sub.employerId);

        const [employer] = await db
          .select({
            id: employersTable.id,
            legacySubscriptionMigratedAt:
              employersTable.legacySubscriptionMigratedAt,
          })
          .from(employersTable)
          .where(eq(employersTable.id, sub.employerId))
          .limit(1);

        if (employer?.legacySubscriptionMigratedAt) {
          summary.skipped += 1;
          continue;
        }
        if (!sub.stripeSubscriptionId) {
          summary.skipped += 1;
          continue;
        }

        try {
          const updated = await stripe.subscriptions.update(
            sub.stripeSubscriptionId,
            { cancel_at_period_end: true },
          );
          // Stripe.Subscription.current_period_end is missing from
          // the typed surface in newer SDK versions but is still
          // returned on the wire; fall back to the line item if not
          // present.
          const subItemPeriodEnd =
            updated.items?.data?.[0]?.current_period_end ?? null;
          const updatedPeriodEnd: number | null = subItemPeriodEnd;
          const now = new Date();
          await db.transaction(async (tx) => {
            await tx
              .update(employersTable)
              .set({ legacySubscriptionMigratedAt: now })
              .where(eq(employersTable.id, sub.employerId));
            await tx
              .update(employerSubscriptionsTable)
              .set({
                updatedAt: now,
                currentPeriodEnd: updatedPeriodEnd
                  ? new Date(updatedPeriodEnd * 1000)
                  : sub.currentPeriodEnd,
              })
              .where(eq(employerSubscriptionsTable.id, sub.id));
          });
          summary.cancelled += 1;
        } catch (err) {
          req.log.error(
            { err, employerId: sub.employerId, subId: sub.id },
            "migrate-legacy: stripe cancel_at_period_end failed",
          );
          summary.failed += 1;
        }
      }

      res.json(summary);
    } catch (err) {
      req.log.error({ err }, "migrate-legacy: top-level failure");
      res.status(500).json({ ...summary, error: "Migration failed" });
    }
  },
);

export default router;
