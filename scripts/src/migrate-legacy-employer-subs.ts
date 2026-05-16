/**
 * One-shot backfill: cancel every legacy recurring employer Stripe
 * subscription at the end of its current billing period.
 *
 * Recurring employer subscriptions have been retired in favor of
 * one-shot per-job tiers (Free / Promoted / Sponsored). This script
 * walks every employer whose most-recent subscription is still
 * `active` or `trialing`, calls
 *   stripe.subscriptions.update(id, { cancel_at_period_end: true })
 * and stamps `employers.legacy_subscription_migrated_at` on success
 * so the migration is idempotent and re-runnable.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run migrate-legacy-employer-subs
 *
 * Env:
 *   DATABASE_URL                  required (read by @workspace/db)
 *   STRIPE_SECRET_KEY             optional override; if unset the script
 *                                 fetches credentials from the Replit
 *                                 Stripe connector (same code path as
 *                                 the API server).
 *   DRY_RUN=1                     log what would happen, do not call
 *                                 Stripe and do not write to the DB.
 */
import Stripe from "stripe";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  employerSubscriptionsTable,
  employersTable,
} from "@workspace/db";

interface ConnectorItem {
  settings: { publishable: string; secret: string };
}

async function getStripeSecretFromConnector(): Promise<string> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) {
    throw new Error(
      "Stripe credentials unavailable: set STRIPE_SECRET_KEY or run inside a Replit environment with the Stripe connector configured.",
    );
  }
  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  const targetEnvironment = isProduction ? "production" : "development";
  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
  });
  if (!response.ok) {
    throw new Error(
      `Replit Stripe connector returned HTTP ${response.status}.`,
    );
  }
  const data = (await response.json()) as { items?: ConnectorItem[] };
  const secret = data.items?.[0]?.settings.secret;
  if (!secret) {
    throw new Error(
      `Stripe ${targetEnvironment} connection isn't configured.`,
    );
  }
  return secret;
}

async function getStripeClient(): Promise<Stripe> {
  const secret =
    process.env.STRIPE_SECRET_KEY ?? (await getStripeSecretFromConnector());
  return new Stripe(secret, { apiVersion: "2026-04-22.dahlia" });
}

interface Summary {
  scanned: number;
  cancelled: number;
  skipped: number;
  failed: number;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const summary: Summary = { scanned: 0, cancelled: 0, skipped: 0, failed: 0 };

  const subs = await db
    .select()
    .from(employerSubscriptionsTable)
    .where(sql`${employerSubscriptionsTable.status} IN ('active','trialing')`)
    .orderBy(
      desc(employerSubscriptionsTable.createdAt),
      desc(employerSubscriptionsTable.id),
    );
  summary.scanned = subs.length;
  console.log(
    `[migrate-legacy] scanned ${subs.length} active/trialing subscription rows${
      dryRun ? " (DRY_RUN)" : ""
    }`,
  );

  const stripe = dryRun ? null : await getStripeClient();
  const seen = new Set<number>();

  for (const sub of subs) {
    if (seen.has(sub.employerId)) {
      summary.skipped += 1;
      continue;
    }
    seen.add(sub.employerId);

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

    if (dryRun || !stripe) {
      console.log(
        `[migrate-legacy] would cancel employer=${sub.employerId} stripeSub=${sub.stripeSubscriptionId}`,
      );
      summary.cancelled += 1;
      continue;
    }

    try {
      const updated = await stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        { cancel_at_period_end: true },
      );
      const itemPeriodEnd =
        updated.items?.data?.[0]?.current_period_end ?? null;
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(employersTable)
          .set({ legacySubscriptionMigratedAt: now })
          .where(
            and(
              eq(employersTable.id, sub.employerId),
              sql`${employersTable.legacySubscriptionMigratedAt} IS NULL`,
            ),
          );
        await tx
          .update(employerSubscriptionsTable)
          .set({
            updatedAt: now,
            currentPeriodEnd: itemPeriodEnd
              ? new Date(itemPeriodEnd * 1000)
              : sub.currentPeriodEnd,
          })
          .where(eq(employerSubscriptionsTable.id, sub.id));
      });
      summary.cancelled += 1;
      console.log(
        `[migrate-legacy] cancelled employer=${sub.employerId} stripeSub=${sub.stripeSubscriptionId}`,
      );
    } catch (err) {
      summary.failed += 1;
      console.error(
        `[migrate-legacy] FAILED employer=${sub.employerId} stripeSub=${sub.stripeSubscriptionId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log("[migrate-legacy] summary", summary);
}

main()
  .catch((err) => {
    console.error("[migrate-legacy] fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
