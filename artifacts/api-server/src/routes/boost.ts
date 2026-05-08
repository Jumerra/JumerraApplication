import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  boostSettingsTable,
  boostPaymentsTable,
  candidatesTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/require-auth";
import {
  getUncachableStripeClient,
  mapStripeCheckoutError,
} from "../stripeClient";

const router: Router = Router();

const SETTINGS_ROW_ID = 1;

const ALLOWED_CURRENCIES = new Set(["usd", "eur", "gbp", "ngn", "ghs", "kes", "zar"]);

type SettingsRow = typeof boostSettingsTable.$inferSelect;

function toApiSettings(row: SettingsRow) {
  return {
    isActive: row.isActive,
    priceCents: row.priceCents,
    currency: row.currency,
    durationDays: row.durationDays,
  };
}

async function loadOrSeedSettings(): Promise<SettingsRow> {
  const existing = await db
    .select()
    .from(boostSettingsTable)
    .where(eq(boostSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (existing[0]) return existing[0];
  // Seed the singleton row on first read so admin form has something to
  // edit. Defaults are intentionally low-priced and inactive — the admin
  // must explicitly enable the feature.
  const inserted = await db
    .insert(boostSettingsTable)
    .values({ id: SETTINGS_ROW_ID })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  // Race-condition fallback: another request inserted; re-read.
  const reread = await db
    .select()
    .from(boostSettingsTable)
    .where(eq(boostSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (!reread[0]) throw new Error("Failed to seed boost_settings row");
  return reread[0];
}

/**
 * GET /api/boost/settings
 * Auth required. Anyone signed in can read so candidate/admin UIs can
 * decide whether to show the CTA.
 */
router.get("/boost/settings", requireAuth, async (_req, res) => {
  const row = await loadOrSeedSettings();
  res.json(toApiSettings(row));
});

/**
 * PUT /api/admin/boost/settings
 * Admin only. Updates the singleton config row.
 */
router.put("/admin/boost/settings", requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      isActive?: unknown;
      priceCents?: unknown;
      currency?: unknown;
      durationDays?: unknown;
    } | null;
    if (!body) {
      res.status(400).json({ error: "Request body required" });
      return;
    }
    const isActive = body.isActive;
    const priceCents = body.priceCents;
    const currency = body.currency;
    const durationDays = body.durationDays;

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
      typeof durationDays !== "number" ||
      !Number.isInteger(durationDays) ||
      durationDays < 1 ||
      durationDays > 365
    ) {
      res
        .status(400)
        .json({ error: "durationDays must be an integer between 1 and 365" });
      return;
    }

    // Ensure the singleton row exists, then update it.
    await loadOrSeedSettings();
    const updated = await db
      .update(boostSettingsTable)
      .set({
        isActive,
        priceCents,
        currency: normalizedCurrency,
        durationDays,
        updatedAt: new Date(),
        updatedBy: req.currentUser!.id,
      })
      .where(eq(boostSettingsTable.id, SETTINGS_ROW_ID))
      .returning();
    if (!updated[0]) {
      res.status(500).json({ error: "Failed to update boost settings" });
      return;
    }
    res.json(toApiSettings(updated[0]));
  } catch (err) {
    req.log.error({ err }, "boost settings update failed");
    res.status(500).json({ error: "Update failed" });
  }
});

/**
 * POST /api/candidates/:id/boost/checkout
 * Authenticated candidate creates a Stripe Checkout Session for their
 * own profile. Admins may also create a session on behalf of any
 * candidate (useful for support).
 */
router.post(
  "/candidates/:id/boost/checkout",
  requireAuth,
  async (req, res) => {
    try {
      const candidateId = Number(req.params.id);
      if (!Number.isInteger(candidateId) || candidateId <= 0) {
        res.status(400).json({ error: "Invalid candidate id" });
        return;
      }
      const user = req.currentUser!;
      const isOwner =
        user.role === "candidate" && user.candidateId === candidateId;
      const isAdmin = user.role === "admin";
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: "Not allowed" });
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
        res
          .status(400)
          .json({ error: "Profile Boost is currently disabled" });
        return;
      }

      const candRows = await db
        .select({ id: candidatesTable.id, fullName: candidatesTable.fullName })
        .from(candidatesTable)
        .where(eq(candidatesTable.id, candidateId))
        .limit(1);
      const candidate = candRows[0];
      if (!candidate) {
        res.status(404).json({ error: "Candidate not found" });
        return;
      }

      let session;
      try {
        const stripe = await getUncachableStripeClient();
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: settings.currency,
                unit_amount: settings.priceCents,
                product_data: {
                  name: `Profile Boost (${settings.durationDays} days)`,
                  description: `Boost ${candidate.fullName}'s profile to top employers for ${settings.durationDays} days.`,
                },
              },
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            candidateId: String(candidateId),
            durationDays: String(settings.durationDays),
            purpose: "profile_boost",
          },
        });
      } catch (stripeErr) {
        const mapped = mapStripeCheckoutError(stripeErr);
        req.log.error(
          {
            err: stripeErr,
            candidateId,
            purpose: "profile_boost",
            ...mapped.logFields,
          },
          "boost checkout: stripe call failed",
        );
        res.status(mapped.status).json(mapped.body);
        return;
      }

      if (!session.url) {
        req.log.error(
          { candidateId, purpose: "profile_boost", sessionId: session.id },
          "boost checkout: stripe returned session without url",
        );
        res.status(502).json({
          error:
            "Stripe didn't return a checkout URL. Please try again or contact support.",
          code: "stripe_no_url",
        });
        return;
      }

      await db.insert(boostPaymentsTable).values({
        candidateId,
        stripeSessionId: session.id,
        amountCents: settings.priceCents,
        currency: settings.currency,
        durationDays: settings.durationDays,
        status: "pending",
      });

      res.json({ sessionId: session.id, checkoutUrl: session.url });
    } catch (err) {
      req.log.error({ err }, "boost checkout: unexpected failure");
      res.status(500).json({
        error:
          "An unexpected error occurred while creating the checkout session.",
        code: "internal_error",
      });
    }
  },
);

/**
 * POST /api/boost/checkout/verify
 * Auth required. Re-checks a session with Stripe and applies the boost
 * to the candidate on success. Idempotent — repeat calls with the same
 * `sessionId` after success simply return the existing expiry.
 */
router.post("/boost/checkout/verify", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as { sessionId?: unknown };
    const sessionId = body.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }

    const paymentRows = await db
      .select()
      .from(boostPaymentsTable)
      .where(eq(boostPaymentsTable.stripeSessionId, sessionId))
      .limit(1);
    const payment = paymentRows[0];
    if (!payment) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const user = req.currentUser!;
    const isOwner =
      user.role === "candidate" && user.candidateId === payment.candidateId;
    const isAdmin = user.role === "admin";
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    // Already finalized — return current state without re-hitting Stripe.
    if (payment.status === "paid") {
      res.json({
        status: "paid",
        boostExpiresAt: payment.boostExpiresAt
          ? payment.boostExpiresAt.toISOString()
          : null,
      });
      return;
    }
    if (payment.status === "failed" || payment.status === "expired") {
      res.json({ status: payment.status, boostExpiresAt: null });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      // Map Stripe's terminal session states onto our stored payment
      // status so future verify calls short-circuit instead of pinging
      // Stripe forever.
      if (session.status === "expired") {
        await db
          .update(boostPaymentsTable)
          .set({ status: "expired" })
          .where(
            and(
              eq(boostPaymentsTable.id, payment.id),
              eq(boostPaymentsTable.status, "pending"),
            ),
          );
        res.json({ status: "expired", boostExpiresAt: null });
        return;
      }
      if (session.status === "complete") {
        // Session is closed but payment never went through — terminal
        // failure (rare for one-shot payment mode, but possible).
        await db
          .update(boostPaymentsTable)
          .set({ status: "failed" })
          .where(
            and(
              eq(boostPaymentsTable.id, payment.id),
              eq(boostPaymentsTable.status, "pending"),
            ),
          );
        res.json({ status: "failed", boostExpiresAt: null });
        return;
      }
      res.json({ status: "pending", boostExpiresAt: null });
      return;
    }

    // Atomic state transition: only the request that actually flips the
    // row from pending->paid is allowed to extend the boost. Concurrent
    // verifiers will see updated.length === 0 and read the finalized
    // state instead, preventing double-extension.
    const finalExpiry = await db.transaction(async (tx) => {
      const flipped = await tx
        .update(boostPaymentsTable)
        .set({ status: "paid", paidAt: new Date() })
        .where(
          and(
            eq(boostPaymentsTable.id, payment.id),
            eq(boostPaymentsTable.status, "pending"),
          ),
        )
        .returning({ id: boostPaymentsTable.id });

      if (flipped.length === 0) {
        // Lost the race — re-read whatever the winner wrote.
        const reread = await tx
          .select({ boostExpiresAt: boostPaymentsTable.boostExpiresAt })
          .from(boostPaymentsTable)
          .where(eq(boostPaymentsTable.id, payment.id))
          .limit(1);
        return reread[0]?.boostExpiresAt ?? null;
      }

      // We won the race. Stack on existing future expiry so a candidate
      // who pays again before their boost runs out gets the full
      // duration they paid for.
      const cand = await tx
        .select({
          boostExpiresAt: candidatesTable.boostExpiresAt,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.id, payment.candidateId))
        .limit(1);
      const current = cand[0]?.boostExpiresAt ?? null;
      const baseline =
        current && current.getTime() > Date.now() ? current : new Date();
      const expires = new Date(
        baseline.getTime() + payment.durationDays * 24 * 60 * 60 * 1000,
      );
      await tx
        .update(candidatesTable)
        .set({ isBoosted: true, boostExpiresAt: expires })
        .where(eq(candidatesTable.id, payment.candidateId));
      await tx
        .update(boostPaymentsTable)
        .set({ boostExpiresAt: expires })
        .where(eq(boostPaymentsTable.id, payment.id));
      return expires;
    });

    res.json({
      status: "paid",
      boostExpiresAt: finalExpiry ? finalExpiry.toISOString() : null,
    });
  } catch (err) {
    req.log.error({ err }, "boost checkout verify failed");
    res.status(500).json({ error: "Verification failed" });
  }
});

export default router;
