import { Router, type IRouter } from "express";
import { and, eq, ilike, sql, count, arrayOverlaps } from "drizzle-orm";
import {
  db,
  jobsTable,
  jobTierSettingsTable,
  jobTierPaymentsTable,
  sponsoredJobPushesTable,
  candidatesTable,
  notificationsTable,
  employersTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/require-auth";
import {
  getUncachableStripeClient,
  mapStripeCheckoutError,
} from "../stripeClient";

const router: IRouter = Router();

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

type SettingsRow = typeof jobTierSettingsTable.$inferSelect;

function toApiSettings(row: SettingsRow) {
  return {
    promotedActive: row.promotedActive,
    promotedPriceCents: row.promotedPriceCents,
    promotedCurrency: row.promotedCurrency,
    promotedDurationDays: row.promotedDurationDays,
    sponsoredActive: row.sponsoredActive,
    sponsoredPriceCents: row.sponsoredPriceCents,
    sponsoredCurrency: row.sponsoredCurrency,
    sponsoredDurationDays: row.sponsoredDurationDays,
    sponsoredPushCap: row.sponsoredPushCap,
  };
}

async function loadOrSeedSettings(): Promise<SettingsRow> {
  const existing = await db
    .select()
    .from(jobTierSettingsTable)
    .where(eq(jobTierSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(jobTierSettingsTable)
    .values({ id: SETTINGS_ROW_ID })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(jobTierSettingsTable)
    .where(eq(jobTierSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (!reread[0]) throw new Error("Failed to seed job_tier_settings row");
  return reread[0];
}

/**
 * Demote any paid jobs whose tier has expired back to 'free'. Cheap
 * single-row UPDATE; called inline before GET /jobs and on demand. Safe
 * to call concurrently — UPDATE ... WHERE expires_at <= now() is
 * idempotent.
 */
export async function sweepExpiredJobTiers(): Promise<void> {
  await db
    .update(jobsTable)
    .set({ tier: "free", tierExpiresAt: null })
    .where(
      and(
        sql`${jobsTable.tier} <> 'free'`,
        sql`${jobsTable.tierExpiresAt} IS NOT NULL`,
        sql`${jobsTable.tierExpiresAt} <= ${new Date()}`,
      ),
    );
}

const PER_CANDIDATE_DAILY_PUSH_CAP = 3;

/**
 * Push a Sponsored job to up to `pushCap` matching candidates. Filters
 * by optional targetSkills / targetLocation. Caps total pushes per
 * job (admin setting) and daily pushes per candidate (hardcoded 3).
 * Idempotent: a candidate already pushed for this job is skipped.
 */
export async function pushSponsoredJobToCandidates(
  job: typeof jobsTable.$inferSelect,
  pushCap: number,
): Promise<number> {
  if (pushCap <= 0) return 0;

  // How many pushes already exist for this job? Bail if we've hit cap.
  const [{ existing }] = await db
    .select({ existing: count() })
    .from(sponsoredJobPushesTable)
    .where(eq(sponsoredJobPushesTable.jobId, job.id));
  const remaining = pushCap - Number(existing ?? 0);
  if (remaining <= 0) return 0;

  // Build candidate query. Targeting is best-effort: skill overlap
  // (text array && operator) and case-insensitive location prefix.
  // Empty arrays are ignored.
  const filters = [];
  const targets =
    Array.isArray(job.targetSkills) && job.targetSkills.length > 0
      ? job.targetSkills
      : null;
  if (targets) {
    filters.push(arrayOverlaps(candidatesTable.skills, targets));
  } else if (job.skills && job.skills.length > 0) {
    filters.push(arrayOverlaps(candidatesTable.skills, job.skills));
  }
  if (job.targetLocation) {
    filters.push(ilike(candidatesTable.location, `%${job.targetLocation}%`));
  } else if (!job.remote && job.location) {
    filters.push(ilike(candidatesTable.location, `%${job.location}%`));
  }

  // Exclude candidates already pushed.
  const alreadyPushedSubq = sql`${candidatesTable.id} NOT IN (
    SELECT ${sponsoredJobPushesTable.candidateId}
    FROM ${sponsoredJobPushesTable}
    WHERE ${sponsoredJobPushesTable.jobId} = ${job.id}
  )`;
  filters.push(alreadyPushedSubq);

  // Daily cap: candidate must have fewer than N pushes in the last 24h.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  filters.push(sql`(
    SELECT count(*) FROM ${sponsoredJobPushesTable}
    WHERE ${sponsoredJobPushesTable.candidateId} = ${candidatesTable.id}
      AND ${sponsoredJobPushesTable.pushedAt} > ${oneDayAgo}
  ) < ${PER_CANDIDATE_DAILY_PUSH_CAP}`);

  // Join through usersTable to get the userId for the notification fan-out.
  // Candidates without a linked user account are skipped (no inbox to push to).
  const candidates = await db
    .select({
      candidateId: candidatesTable.id,
      userId: usersTable.id,
    })
    .from(candidatesTable)
    .innerJoin(usersTable, eq(usersTable.candidateId, candidatesTable.id))
    .where(and(...filters))
    .limit(remaining);

  if (candidates.length === 0) return 0;

  // Look up employer name for the notification body.
  const [employer] = await db
    .select({ name: employersTable.name })
    .from(employersTable)
    .where(eq(employersTable.id, job.employerId))
    .limit(1);

  const link = `/jobs/${job.id}`;
  const title = `Sponsored opportunity: ${job.title}`;
  const body = employer
    ? `${employer.name} is actively looking for candidates like you.`
    : `A new sponsored job matches your profile.`;

  // Insert pushes + notifications. Use one transaction so we don't end
  // up with orphan notifications without push records (which would let
  // us re-push the same candidate next sweep). The unique index on
  // (job_id, candidate_id) makes the insert race-safe: if two
  // concurrent verifications both pick the same candidate, one INSERT
  // wins and the other gets `onConflictDoNothing` → empty `inserted`,
  // and only the winner sends the notification. This also means we
  // never overshoot `pushCap` by more than the size of one batch
  // window, even under contention.
  const inserted = await db.transaction(async (tx) => {
    const winners = await tx
      .insert(sponsoredJobPushesTable)
      .values(
        candidates.map((c) => ({ jobId: job.id, candidateId: c.candidateId })),
      )
      .onConflictDoNothing({
        target: [
          sponsoredJobPushesTable.jobId,
          sponsoredJobPushesTable.candidateId,
        ],
      })
      .returning({ candidateId: sponsoredJobPushesTable.candidateId });
    const wonIds = new Set(winners.map((w) => w.candidateId));
    const notifs = candidates
      .filter((c) => wonIds.has(c.candidateId))
      .map((c) => ({
        userId: c.userId,
        kind: "sponsored_job",
        title,
        body,
        link,
      }));
    if (notifs.length > 0) {
      await tx.insert(notificationsTable).values(notifs);
    }
    return notifs.length;
  });

  return inserted;
}

router.get("/job-tier-settings", async (_req, res) => {
  const row = await loadOrSeedSettings();
  res.json(toApiSettings(row));
});

router.put("/admin/job-tier-settings", requireAdmin, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const validInt = (v: unknown, min: number, max: number) =>
      typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

    if (typeof body.promotedActive !== "boolean") {
      res.status(400).json({ error: "promotedActive must be boolean" });
      return;
    }
    if (typeof body.sponsoredActive !== "boolean") {
      res.status(400).json({ error: "sponsoredActive must be boolean" });
      return;
    }
    if (!validInt(body.promotedPriceCents, 50, 10_000_000)) {
      res
        .status(400)
        .json({ error: "promotedPriceCents must be 50-10000000" });
      return;
    }
    if (!validInt(body.sponsoredPriceCents, 50, 10_000_000)) {
      res
        .status(400)
        .json({ error: "sponsoredPriceCents must be 50-10000000" });
      return;
    }
    if (!validInt(body.promotedDurationDays, 1, 365)) {
      res
        .status(400)
        .json({ error: "promotedDurationDays must be 1-365" });
      return;
    }
    if (!validInt(body.sponsoredDurationDays, 1, 365)) {
      res
        .status(400)
        .json({ error: "sponsoredDurationDays must be 1-365" });
      return;
    }
    if (!validInt(body.sponsoredPushCap, 0, 100_000)) {
      res
        .status(400)
        .json({ error: "sponsoredPushCap must be 0-100000" });
      return;
    }
    const promotedCurrency = String(body.promotedCurrency ?? "").toLowerCase();
    const sponsoredCurrency = String(
      body.sponsoredCurrency ?? "",
    ).toLowerCase();
    if (!ALLOWED_CURRENCIES.has(promotedCurrency)) {
      res.status(400).json({
        error: `promotedCurrency must be one of: ${Array.from(ALLOWED_CURRENCIES).join(", ")}`,
      });
      return;
    }
    if (!ALLOWED_CURRENCIES.has(sponsoredCurrency)) {
      res.status(400).json({
        error: `sponsoredCurrency must be one of: ${Array.from(ALLOWED_CURRENCIES).join(", ")}`,
      });
      return;
    }

    await loadOrSeedSettings();
    const updated = await db
      .update(jobTierSettingsTable)
      .set({
        promotedActive: body.promotedActive,
        promotedPriceCents: body.promotedPriceCents as number,
        promotedCurrency,
        promotedDurationDays: body.promotedDurationDays as number,
        sponsoredActive: body.sponsoredActive,
        sponsoredPriceCents: body.sponsoredPriceCents as number,
        sponsoredCurrency,
        sponsoredDurationDays: body.sponsoredDurationDays as number,
        sponsoredPushCap: body.sponsoredPushCap as number,
        updatedAt: new Date(),
        updatedBy: req.currentUser!.id,
      })
      .where(eq(jobTierSettingsTable.id, SETTINGS_ROW_ID))
      .returning();
    if (!updated[0]) {
      res.status(500).json({ error: "Failed to update job tier settings" });
      return;
    }
    res.json(toApiSettings(updated[0]));
  } catch (err) {
    req.log.error({ err }, "job tier settings update failed");
    res.status(500).json({ error: "Update failed" });
  }
});

router.post(
  "/jobs/:id/promote/checkout",
  requireAuth,
  async (req, res) => {
    try {
      const jobId = Number(req.params.id);
      if (!Number.isInteger(jobId) || jobId <= 0) {
        res.status(400).json({ error: "Invalid job id" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const tier = body.tier;
      const successUrl = body.successUrl;
      const cancelUrl = body.cancelUrl;
      if (tier !== "promoted" && tier !== "sponsored") {
        res.status(400).json({ error: "tier must be promoted or sponsored" });
        return;
      }
      if (typeof successUrl !== "string" || !/^https?:\/\//.test(successUrl)) {
        res.status(400).json({ error: "successUrl must be an absolute URL" });
        return;
      }
      if (typeof cancelUrl !== "string" || !/^https?:\/\//.test(cancelUrl)) {
        res.status(400).json({ error: "cancelUrl must be an absolute URL" });
        return;
      }

      const [job] = await db
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.id, jobId))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      const user = req.currentUser!;
      const isAdmin = user.role === "admin";
      const isOwnerEmployer =
        user.role === "employer" &&
        user.employerId === job.employerId &&
        user.orgRole === "owner";
      if (!isAdmin && !isOwnerEmployer) {
        res.status(403).json({
          error: "Only employer owners or platform admins can boost a job",
        });
        return;
      }

      const settings = await loadOrSeedSettings();
      const isPromoted = tier === "promoted";
      const isActive = isPromoted
        ? settings.promotedActive
        : settings.sponsoredActive;
      if (!isActive) {
        res
          .status(400)
          .json({ error: `${tier} tier is currently disabled` });
        return;
      }
      const priceCents = isPromoted
        ? settings.promotedPriceCents
        : settings.sponsoredPriceCents;
      const currency = isPromoted
        ? settings.promotedCurrency
        : settings.sponsoredCurrency;
      const durationDays = isPromoted
        ? settings.promotedDurationDays
        : settings.sponsoredDurationDays;

      const [employer] = await db
        .select({ name: employersTable.name })
        .from(employersTable)
        .where(eq(employersTable.id, job.employerId))
        .limit(1);

      let session;
      try {
        const stripe = await getUncachableStripeClient();
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: priceCents,
                product_data: {
                  name: `${isPromoted ? "Promoted" : "Sponsored"} Job (${durationDays} days)`,
                  description: `${
                    isPromoted ? "Higher placement" : "Top placement + active candidate push"
                  } for "${job.title}"${employer ? ` at ${employer.name}` : ""}.`,
                },
              },
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            jobId: String(jobId),
            tier,
            durationDays: String(durationDays),
            purpose: "job_tier",
          },
        });
      } catch (stripeErr) {
        const mapped = mapStripeCheckoutError(stripeErr);
        req.log.error(
          {
            err: stripeErr,
            jobId,
            tier,
            purpose: "job_tier",
            ...mapped.logFields,
          },
          "job tier checkout: stripe call failed",
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

      await db.insert(jobTierPaymentsTable).values({
        jobId,
        employerId: job.employerId,
        tier,
        stripeSessionId: session.id,
        amountCents: priceCents,
        currency,
        durationDays,
        status: "pending",
      });

      res.json({ sessionId: session.id, checkoutUrl: session.url });
    } catch (err) {
      req.log.error({ err }, "job tier checkout: unexpected failure");
      res.status(500).json({
        error: "An unexpected error occurred while creating the checkout session.",
        code: "internal_error",
      });
    }
  },
);

router.post("/job-tier/checkout/verify", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as { sessionId?: unknown };
    const sessionId = body.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }

    const paymentRows = await db
      .select()
      .from(jobTierPaymentsTable)
      .where(eq(jobTierPaymentsTable.stripeSessionId, sessionId))
      .limit(1);
    const payment = paymentRows[0];
    if (!payment) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const user = req.currentUser!;
    const isAdmin = user.role === "admin";
    const isOwner =
      user.role === "employer" &&
      user.employerId === payment.employerId &&
      user.orgRole === "owner";
    if (!isAdmin && !isOwner) {
      res.status(403).json({
        error: "Only employer owners or platform admins can verify a boost",
      });
      return;
    }

    const respondFromPayment = async (
      status: "pending" | "paid" | "failed" | "expired",
    ) => {
      const [job] = await db
        .select({
          id: jobsTable.id,
          tier: jobsTable.tier,
          tierExpiresAt: jobsTable.tierExpiresAt,
        })
        .from(jobsTable)
        .where(eq(jobsTable.id, payment.jobId))
        .limit(1);
      res.json({
        status,
        jobId: payment.jobId,
        tier: job?.tier ?? "free",
        tierExpiresAt:
          job?.tierExpiresAt ? job.tierExpiresAt.toISOString() : null,
      });
    };

    if (payment.status === "paid") {
      await respondFromPayment("paid");
      return;
    }
    if (payment.status === "failed" || payment.status === "expired") {
      await respondFromPayment(payment.status);
      return;
    }

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      if (session.status === "expired") {
        await db
          .update(jobTierPaymentsTable)
          .set({ status: "expired" })
          .where(
            and(
              eq(jobTierPaymentsTable.id, payment.id),
              eq(jobTierPaymentsTable.status, "pending"),
            ),
          );
        await respondFromPayment("expired");
        return;
      }
      if (session.status === "complete") {
        await db
          .update(jobTierPaymentsTable)
          .set({ status: "failed" })
          .where(
            and(
              eq(jobTierPaymentsTable.id, payment.id),
              eq(jobTierPaymentsTable.status, "pending"),
            ),
          );
        await respondFromPayment("failed");
        return;
      }
      await respondFromPayment("pending");
      return;
    }

    // Atomic flip pending -> paid; only the winner activates the tier.
    const result = await db.transaction(async (tx) => {
      const flipped = await tx
        .update(jobTierPaymentsTable)
        .set({ status: "paid", paidAt: new Date() })
        .where(
          and(
            eq(jobTierPaymentsTable.id, payment.id),
            eq(jobTierPaymentsTable.status, "pending"),
          ),
        )
        .returning({ id: jobTierPaymentsTable.id });

      if (flipped.length === 0) {
        const [job] = await tx
          .select({
            tier: jobsTable.tier,
            tierExpiresAt: jobsTable.tierExpiresAt,
          })
          .from(jobsTable)
          .where(eq(jobsTable.id, payment.jobId))
          .limit(1);
        return { won: false as const, job };
      }

      // Compute new expiry. If the existing paid tier matches and is
      // still in the future, stack the new duration on top.
      const [existing] = await tx
        .select({
          tier: jobsTable.tier,
          tierExpiresAt: jobsTable.tierExpiresAt,
        })
        .from(jobsTable)
        .where(eq(jobsTable.id, payment.jobId))
        .limit(1);
      const stackable =
        existing?.tier === payment.tier &&
        existing.tierExpiresAt &&
        existing.tierExpiresAt.getTime() > Date.now()
          ? existing.tierExpiresAt
          : new Date();
      const expires = new Date(
        stackable.getTime() + payment.durationDays * 24 * 60 * 60 * 1000,
      );

      await tx
        .update(jobsTable)
        .set({ tier: payment.tier, tierExpiresAt: expires })
        .where(eq(jobsTable.id, payment.jobId));
      await tx
        .update(jobTierPaymentsTable)
        .set({ tierExpiresAt: expires })
        .where(eq(jobTierPaymentsTable.id, payment.id));
      return { won: true as const, expires };
    });

    // If we won the race AND the tier is sponsored, fan out to candidates.
    if (result.won && payment.tier === "sponsored") {
      try {
        const settings = await loadOrSeedSettings();
        const [job] = await db
          .select()
          .from(jobsTable)
          .where(eq(jobsTable.id, payment.jobId))
          .limit(1);
        if (job) {
          const pushed = await pushSponsoredJobToCandidates(
            job,
            settings.sponsoredPushCap,
          );
          req.log.info(
            { jobId: payment.jobId, pushed },
            "sponsored job: pushed to candidates",
          );
        }
      } catch (pushErr) {
        // Non-fatal — payment is already recorded.
        req.log.error(
          { err: pushErr, jobId: payment.jobId },
          "sponsored push fan-out failed",
        );
      }
    }

    await respondFromPayment("paid");
  } catch (err) {
    req.log.error({ err }, "job tier checkout verify failed");
    res.status(500).json({ error: "Verification failed" });
  }
});

export default router;
