import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  institutionSubscriptionSettingsTable,
  institutionSubscriptionsTable,
  institutionsTable,
  usersTable,
} from "@workspace/db";
import {
  requireAuth,
  requireAdmin,
} from "../middleware/require-auth";
import { getUncachableStripeClient } from "../stripeClient";
import { selectPaymentRail, type PaymentRail } from "../lib/payment-rail";
import {
  paystackInitializeTransaction,
  paystackVerifyTransaction,
} from "../paystackClient";
import { finalizeInstitutionSubscriptionFromPaystack } from "../lib/payment-finalizers";

/**
 * Strip Stripe's `{CHECKOUT_SESSION_ID}` placeholder from a success URL
 * before handing it to Paystack as a callback. Paystack appends its own
 * `?reference=...&trxref=...`, and the return page accepts both shapes.
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

type SettingsRow = typeof institutionSubscriptionSettingsTable.$inferSelect;
type SubRow = typeof institutionSubscriptionsTable.$inferSelect;

function toApiSettings(row: SettingsRow) {
  return {
    isActive: row.isActive,
    priceCents: row.priceCents,
    currency: row.currency,
    intervalDays: row.intervalDays,
    trialDays: row.trialDays,
  };
}

/**
 * Map our admin-configurable `intervalDays` (30 = monthly, 365 = yearly)
 * onto the Stripe Price recurring config. Any other value falls back
 * to monthly so we never crash checkout for a corrupted settings row.
 */
function stripeRecurringFor(intervalDays: number): {
  interval: "month" | "year";
  interval_count: number;
} {
  if (intervalDays >= 365) return { interval: "year", interval_count: 1 };
  return { interval: "month", interval_count: 1 };
}

async function loadOrSeedSettings(): Promise<SettingsRow> {
  const existing = await db
    .select()
    .from(institutionSubscriptionSettingsTable)
    .where(eq(institutionSubscriptionSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (existing[0]) return existing[0];
  // Seed the singleton row on first read so admin form has something to
  // edit. Defaults are intentionally inactive — admin must enable.
  const inserted = await db
    .insert(institutionSubscriptionSettingsTable)
    .values({ id: SETTINGS_ROW_ID })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(institutionSubscriptionSettingsTable)
    .where(eq(institutionSubscriptionSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (!reread[0]) {
    throw new Error("Failed to seed institution_subscription_settings row");
  }
  return reread[0];
}

/**
 * "Current" subscription for an institution.
 *
 * We can't trust simple "latest row" ordering: a brand-new pending
 * checkout (or a failed retry) would mask an existing active/trialing
 * subscription and incorrectly lock the institution out.
 *
 * Resolution rules:
 *   1. Prefer the most recent row whose Stripe-side state is currently
 *      valid (trialing/active AND its time-window hasn't passed).
 *   2. Otherwise return the most recent row of any status, so the UI
 *      can still render pending/failed/expired states.
 */
async function loadCurrentSubscription(
  institutionId: number,
): Promise<SubRow | null> {
  const rows = await db
    .select()
    .from(institutionSubscriptionsTable)
    .where(eq(institutionSubscriptionsTable.institutionId, institutionId))
    .orderBy(desc(institutionSubscriptionsTable.createdAt));
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

/**
 * Find a recent open checkout session for this institution that we can
 * safely reuse instead of creating a duplicate Stripe session. We
 * consider a pending row "reusable" only if it is younger than 1 hour
 * — Stripe Checkout Sessions expire after 24h but we'd rather force a
 * fresh session well before that to avoid edge cases.
 */
async function findReusablePendingCheckout(
  institutionId: number,
): Promise<SubRow | null> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(institutionSubscriptionsTable)
    .where(
      and(
        eq(institutionSubscriptionsTable.institutionId, institutionId),
        eq(institutionSubscriptionsTable.status, "pending"),
      ),
    )
    .orderBy(desc(institutionSubscriptionsTable.createdAt))
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
  intervalDaysSnapshot: number | null;
  isInTrial: boolean;
  unlocksPlacements: boolean;
}

/**
 * Coerce a stored row into the API-shaped status the UI consumes.
 *
 * If the row is in `trialing` or `active` but its `currentPeriodEnd`
 * (or `trialEndsAt` when still in trial) has passed, we surface it as
 * `expired` so the UI doesn't keep telling the user they're subscribed
 * when Stripe stopped renewing them. The DB row is left untouched —
 * the verify endpoint or a future webhook is the only path that mutates
 * row-level state.
 */
function rowToApiStatus(row: SubRow | null): ApiStatus {
  if (!row) {
    return {
      status: "none",
      trialEndsAt: null,
      currentPeriodEnd: null,
      priceCentsSnapshot: null,
      currencySnapshot: null,
      intervalDaysSnapshot: null,
      isInTrial: false,
      unlocksPlacements: false,
    };
  }
  const now = Date.now();
  const trialEnd = row.trialEndsAt;
  const periodEnd = row.currentPeriodEnd;
  const inTrial = !!(trialEnd && trialEnd.getTime() > now);
  const inActivePeriod = !!(periodEnd && periodEnd.getTime() > now);

  let status: StatusName = (row.status as StatusName) ?? "none";

  // Auto-derive expired view when the snapshot is stale; trialing rows
  // expire at trialEndsAt unless they have rolled into a paid period.
  if (status === "trialing" && !inTrial && !inActivePeriod) {
    status = "expired";
  }
  if (status === "active" && !inActivePeriod) {
    status = "expired";
  }

  const unlocks = status === "trialing" || status === "active";
  return {
    status,
    trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
    currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    priceCentsSnapshot: row.priceCentsSnapshot,
    currencySnapshot: row.currencySnapshot,
    intervalDaysSnapshot: row.intervalDaysSnapshot,
    isInTrial: inTrial,
    unlocksPlacements: unlocks,
  };
}

/**
 * Generic premium-feature gate. Use from any other router that
 * paywalls an Institution Pro feature. Mirrors the legacy
 * `isInstitutionPlacementUnlocked` semantics so any new gating is
 * coherent with the existing placements gate.
 */
export async function isInstitutionPremium(
  institutionId: number,
): Promise<boolean> {
  return isInstitutionPlacementUnlocked(institutionId);
}

/**
 * Public helper for other routers (notably the institution dashboard
 * gate): returns whether placements should be unlocked for this
 * institution given the current admin toggle and subscription state.
 *
 * When the admin toggle is OFF, placements are ALWAYS unlocked — the
 * subscription feature is dormant and we don't want to break existing
 * users. When ON, only `trialing`/`active` subs unlock placements.
 */
export async function isInstitutionPlacementUnlocked(
  institutionId: number,
): Promise<boolean> {
  const settings = await loadOrSeedSettings();
  if (!settings.isActive) return true;
  const row = await loadCurrentSubscription(institutionId);
  return rowToApiStatus(row).unlocksPlacements;
}

// ---------------------------------------------------------------------------
// GET /api/institution-subscription/settings
// Auth required. Anyone signed in reads so the institution UI knows
// whether to render the CTA, and the admin page renders the form.
// ---------------------------------------------------------------------------
router.get(
  "/institution-subscription/settings",
  requireAuth,
  async (_req, res) => {
    const row = await loadOrSeedSettings();
    res.json(toApiSettings(row));
  },
);

// ---------------------------------------------------------------------------
// PUT /api/admin/institution-subscription/settings
// Admin only. Updates the singleton config row.
// ---------------------------------------------------------------------------
router.put(
  "/admin/institution-subscription/settings",
  requireAdmin,
  async (req, res) => {
    try {
      const body = req.body as {
        isActive?: unknown;
        priceCents?: unknown;
        currency?: unknown;
        intervalDays?: unknown;
        trialDays?: unknown;
      } | null;
      if (!body) {
        res.status(400).json({ error: "Request body required" });
        return;
      }
      const { isActive, priceCents, currency, intervalDays, trialDays } = body;

      if (typeof isActive !== "boolean") {
        res.status(400).json({ error: "isActive must be boolean" });
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
      if (
        typeof intervalDays !== "number" ||
        (intervalDays !== 30 && intervalDays !== 365)
      ) {
        res.status(400).json({
          error: "intervalDays must be 30 (monthly) or 365 (yearly)",
        });
        return;
      }

      await loadOrSeedSettings();
      const updated = await db
        .update(institutionSubscriptionSettingsTable)
        .set({
          isActive,
          priceCents,
          currency: normalizedCurrency,
          intervalDays,
          trialDays,
          updatedAt: new Date(),
          updatedBy: req.currentUser!.id,
        })
        .where(eq(institutionSubscriptionSettingsTable.id, SETTINGS_ROW_ID))
        .returning();
      if (!updated[0]) {
        res
          .status(500)
          .json({ error: "Failed to update institution subscription settings" });
        return;
      }
      res.json(toApiSettings(updated[0]));
    } catch (err) {
      req.log.error({ err }, "institution subscription settings update failed");
      res.status(500).json({ error: "Update failed" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/institutions/:id/subscription
// Returns the current subscription status for an institution. Visible
// to: any staff member of that institution, or any admin.
// ---------------------------------------------------------------------------
router.get(
  "/institutions/:id/subscription",
  requireAuth,
  async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!Number.isInteger(institutionId) || institutionId <= 0) {
      res.status(400).json({ error: "Invalid institution id" });
      return;
    }
    const user = req.currentUser!;
    const isAdmin = user.role === "admin";
    const isMember =
      user.role === "institution" && user.institutionId === institutionId;
    if (!isAdmin && !isMember) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    const inst = await db
      .select({ id: institutionsTable.id })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, institutionId))
      .limit(1);
    if (!inst[0]) {
      res.status(404).json({ error: "Institution not found" });
      return;
    }

    const row = await loadCurrentSubscription(institutionId);
    res.json(rowToApiStatus(row));
  },
);

// ---------------------------------------------------------------------------
// POST /api/institutions/:id/subscription/checkout
// Owner of the institution (or admin) creates a Stripe Checkout
// Session in `subscription` mode with the configured trial length.
// ---------------------------------------------------------------------------
router.post(
  "/institutions/:id/subscription/checkout",
  requireAuth,
  async (req, res) => {
    try {
      const institutionId = Number(req.params.id);
      if (!Number.isInteger(institutionId) || institutionId <= 0) {
        res.status(400).json({ error: "Invalid institution id" });
        return;
      }
      const user = req.currentUser!;
      const isAdmin = user.role === "admin";
      const isOwner =
        user.role === "institution" &&
        user.institutionId === institutionId &&
        user.orgRole === "owner";
      if (!isAdmin && !isOwner) {
        res.status(403).json({
          error: "Only institution owners or platform admins can subscribe",
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
          error: "Institution subscriptions are currently disabled",
        });
        return;
      }

      const inst = await db
        .select({ id: institutionsTable.id, name: institutionsTable.name })
        .from(institutionsTable)
        .where(eq(institutionsTable.id, institutionId))
        .limit(1);
      const institution = inst[0];
      if (!institution) {
        res.status(404).json({ error: "Institution not found" });
        return;
      }

      // Block double-subscribing while one is already live.
      const existing = await loadCurrentSubscription(institutionId);
      const existingStatus = rowToApiStatus(existing);
      if (existingStatus.unlocksPlacements) {
        res.status(400).json({
          error: "Institution already has an active subscription",
        });
        return;
      }

      // Africa-first rail selection. NGN/GHS/ZAR/KES go to Paystack
      // when configured (local acquiring, lower fees, USSD/bank-transfer
      // fallbacks). Everything else, and any case where Paystack isn't
      // configured, falls through to Stripe. Caller can override via
      // body.rail. The default seeded currency is `ngn`, so out-of-the-box
      // institution subscriptions route through Paystack.
      const railOverride =
        typeof (body as { rail?: unknown }).rail === "string"
          ? ((body as { rail: string }).rail as PaymentRail)
          : null;
      const rail = selectPaymentRail({
        currency: settings.currency,
        override: railOverride,
      });

      if (rail === "paystack") {
        // Paystack doesn't model recurring subscriptions via our thin
        // client (the Plan API is intentionally not wired yet). We
        // model an institution subscription as a one-shot charge that
        // covers `intervalDays`; renewal is a future explicit checkout.
        // The webhook + finalizer flip the row to `active` and stamp
        // `currentPeriodEnd = now + intervalDays`.
        const u = await db
          .select({ email: usersTable.email })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.institutionId, institutionId),
              eq(usersTable.orgRole, "owner"),
            ),
          )
          .limit(1);
        const email = u[0]?.email ?? null;
        if (!email) {
          res.status(400).json({
            error:
              "Paystack checkout requires an institution owner email; add an owner with an email first.",
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
              institutionId,
              purpose: "institution_subscription",
              intervalDays: settings.intervalDays,
            },
          });
          await db.insert(institutionSubscriptionsTable).values({
            institutionId,
            // The stripe_checkout_session_id column carries a UNIQUE
            // constraint and is required on the row. For Paystack rows
            // we reuse the reference as the external id so the
            // constraint still protects us from duplicate inserts.
            stripeCheckoutSessionId: init.reference,
            provider: "paystack",
            paystackReference: init.reference,
            status: "pending",
            priceCentsSnapshot: settings.priceCents,
            currencySnapshot: settings.currency,
            intervalDaysSnapshot: settings.intervalDays,
            // No native trial on Paystack one-shot rail.
            trialDaysSnapshot: 0,
          });
          res.json({
            sessionId: init.reference,
            checkoutUrl: init.authorization_url,
            provider: "paystack",
          });
          return;
        } catch (paystackErr) {
          req.log.error(
            { err: paystackErr, institutionId },
            "institution subscription checkout: paystack init failed",
          );
          res.status(502).json({
            error:
              "Could not start Paystack checkout. Please try again in a moment.",
            code: "paystack_init_failed",
          });
          return;
        }
      }

      // Idempotency: if there's a recent pending checkout session,
      // re-issue its URL instead of creating a duplicate Stripe session
      // (and a duplicate DB row). This makes accidental double-clicks
      // and the user-clicks-back-then-clicks-again flow safe. Stripe
      // sessions stay valid for 24h; we cap reuse at 1h to avoid edge
      // cases around expiring sessions.
      const stripe = await getUncachableStripeClient();
      const reusable = await findReusablePendingCheckout(institutionId);
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
          // Stripe doesn't know about this session anymore — fall
          // through to create a fresh one.
          req.log.warn(
            { err: retrieveErr, sessionId: reusable.stripeCheckoutSessionId },
            "could not retrieve pending session for reuse, creating new one",
          );
        }
      }

      const checkout = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: settings.currency,
              unit_amount: settings.priceCents,
              recurring: stripeRecurringFor(settings.intervalDays),
              product_data: {
                name: `${institution.name} — Institution Pro (${
                  settings.intervalDays >= 365 ? "yearly" : "monthly"
                })`,
                description: `Institution Pro subscription for ${institution.name}: unlocks placements, bulk verification, advanced analytics, branded profile, priority placement and more.${
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
        // Skip the credit-card requirement when the admin has configured
        // a free trial — the user only enters payment info if/when the
        // trial is about to convert. With no trial we still require a
        // card up front so the first invoice can be charged immediately.
        payment_method_collection:
          settings.trialDays > 0 ? "if_required" : "always",
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          institutionId: String(institutionId),
          purpose: "institution_subscription",
        },
      });

      if (!checkout.url) {
        res
          .status(500)
          .json({ error: "Stripe did not return a checkout URL" });
        return;
      }

      await db.insert(institutionSubscriptionsTable).values({
        institutionId,
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
        "institution subscription checkout creation failed",
      );
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/institution-subscription/checkout/verify
// Verifies a Stripe Checkout Session, fetches the subscription state
// from Stripe, and writes it into our row. Idempotent — repeat calls
// for an already-finalized row simply return the current state.
// ---------------------------------------------------------------------------
router.post(
  "/institution-subscription/checkout/verify",
  requireAuth,
  async (req, res) => {
    try {
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

      const rows = await db
        .select()
        .from(institutionSubscriptionsTable)
        .where(
          eq(
            institutionSubscriptionsTable.stripeCheckoutSessionId,
            externalRef,
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
        user.role === "institution" && user.institutionId === row.institutionId;
      if (!isAdmin && !isMember) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }

      // Already terminal — short-circuit.
      if (
        row.status === "trialing" ||
        row.status === "active" ||
        row.status === "expired" ||
        row.status === "canceled" ||
        row.status === "failed"
      ) {
        res.json(rowToApiStatus(row));
        return;
      }

      // Paystack branch: fetch transaction state from Paystack and run
      // the same finalizer the webhook uses, so verify + webhook can
      // never disagree on the final row state. The finalizer is
      // idempotent.
      if (row.provider === "paystack") {
        const ref = row.paystackReference ?? externalRef;
        try {
          const verifyResp = await paystackVerifyTransaction(ref);
          if (verifyResp.status === "success") {
            await finalizeInstitutionSubscriptionFromPaystack(ref);
          } else if (
            verifyResp.status === "failed" ||
            verifyResp.status === "abandoned"
          ) {
            await db
              .update(institutionSubscriptionsTable)
              .set({ status: "failed", updatedAt: new Date() })
              .where(
                and(
                  eq(institutionSubscriptionsTable.id, row.id),
                  eq(institutionSubscriptionsTable.status, "pending"),
                ),
              );
          }
          const fresh = await loadCurrentSubscription(row.institutionId);
          res.json(rowToApiStatus(fresh));
          return;
        } catch (paystackErr) {
          req.log.error(
            { err: paystackErr, ref, institutionId: row.institutionId },
            "institution subscription verify: paystack verify failed",
          );
          res.status(502).json({
            error: "Could not verify Paystack transaction. Please try again.",
            code: "paystack_verify_failed",
          });
          return;
        }
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(externalRef, {
        expand: ["subscription"],
      });

      // Stripe returns the Subscription object inline because we asked
      // for it via `expand`. Type it loosely; the only fields we need
      // are status, trial_end, current_period_end, customer, id.
      // Note: in recent Stripe API versions `current_period_end` moved
      // from the Subscription itself onto each subscription item, so we
      // accept either shape.
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

      // Checkout closed without producing a subscription -> failed.
      if (session.status === "expired") {
        await db
          .update(institutionSubscriptionsTable)
          .set({ status: "expired", updatedAt: new Date() })
          .where(
            and(
              eq(institutionSubscriptionsTable.id, row.id),
              eq(institutionSubscriptionsTable.status, "pending"),
            ),
          );
        const fresh = await loadCurrentSubscription(row.institutionId);
        res.json(rowToApiStatus(fresh));
        return;
      }

      if (!sub) {
        // Still waiting on Stripe to finalize — let the client poll.
        res.json(rowToApiStatus(row));
        return;
      }

      const customerId =
        typeof sub.customer === "string"
          ? sub.customer
          : sub.customer?.id ?? null;

      // Map Stripe's subscription.status onto our internal enum. Stripe
      // returns one of: incomplete, incomplete_expired, trialing,
      // active, past_due, canceled, unpaid, paused.
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
        // Customer hasn't completed the initial payment; let them
        // retry — keep the row pending.
        res.json(rowToApiStatus(row));
        return;
      }

      const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
      const periodEndUnix =
        sub.current_period_end ??
        sub.items?.data?.[0]?.current_period_end ??
        null;
      if (!periodEndUnix) {
        // Stripe didn't give us a period end yet — keep the row pending
        // and let the client retry verification.
        res.json(rowToApiStatus(row));
        return;
      }
      const currentPeriodEnd = new Date(periodEndUnix * 1000);

      await db
        .update(institutionSubscriptionsTable)
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
        .where(eq(institutionSubscriptionsTable.id, row.id));

      const fresh = await loadCurrentSubscription(row.institutionId);
      res.json(rowToApiStatus(fresh));
    } catch (err) {
      req.log.error(
        { err },
        "institution subscription verify failed",
      );
      res.status(500).json({ error: "Verification failed" });
    }
  },
);

export default router;
