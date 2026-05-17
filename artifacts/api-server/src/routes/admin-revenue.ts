import { Router } from "express";
import { db, paymentsTable } from "@workspace/db";
import { and, gte, lte, inArray, sql, eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middleware/require-auth";
import { requirePermission } from "../lib/permissions";
import {
  finalizeFromStripeSessionId,
  finalizeFromPaystackReference,
} from "../lib/payment-finalizers";

const router: Router = Router();

/**
 * Maps the polymorphic `payments.purpose_type` into the three
 * business-facing categories the dashboard surfaces.
 *
 *   candidate   = boost + cv
 *   institution = institution_subscription
 *   employer    = job_tier + employer_subscription
 *
 * Implemented as a SQL CASE so the bucketing happens in Postgres and
 * not in the API process — keeps the result set tiny even when the
 * payments table grows.
 */
const CATEGORY_CASE = sql<string>`CASE
  WHEN ${paymentsTable.purposeType} IN ('boost', 'cv') THEN 'candidate'
  WHEN ${paymentsTable.purposeType} = 'institution_subscription' THEN 'institution'
  WHEN ${paymentsTable.purposeType} IN ('job_tier', 'employer_subscription') THEN 'employer'
  ELSE 'other'
END`;

/**
 * Only successful payments count toward revenue. The unified ledger
 * stores both 'paid' (one-shot flows: boost, cv, job_tier, and the
 * Paystack one-shot-per-period subscription rows) and 'active' /
 * 'trialing' (Stripe recurring subscriptions). Everything else
 * ('pending', 'failed', etc.) is ignored.
 */
const REVENUE_STATUSES = ["paid", "active", "trialing"];

function parseDateRange(req: { query: Record<string, unknown> }): {
  from: Date | null;
  to: Date | null;
} {
  const raw = req.query;
  const fromStr = typeof raw.from === "string" ? raw.from : null;
  const toStr = typeof raw.to === "string" ? raw.to : null;
  const from = fromStr ? new Date(fromStr) : null;
  const to = toStr ? new Date(toStr) : null;
  return {
    from: from && !Number.isNaN(from.getTime()) ? from : null,
    to: to && !Number.isNaN(to.getTime()) ? to : null,
  };
}

/**
 * GET /admin/revenue/summary?from=&to=
 *
 * Aggregates the unified payments ledger for the dashboard's KPI
 * cards and breakdown widgets. All money is reported in **subunits**
 * (cents for USD, kobo for NGN, etc.) so the client never has to deal
 * with floating-point currency math; format with a per-currency
 * divisor (always 100 for the rails we support today).
 *
 * Currencies are NEVER summed across — mixing NGN and USD into a
 * single total is meaningless without an FX rate, which we don't have.
 * Each currency is returned as its own row.
 */
router.get(
  "/admin/revenue/summary",
  requireAdmin,
  requirePermission("payments:view"),
  async (req, res) => {
    const { from, to } = parseDateRange(req);
    const conds = [
      inArray(paymentsTable.status, REVENUE_STATUSES),
    ];
    if (from) conds.push(gte(paymentsTable.finalizedAt, from));
    if (to) conds.push(lte(paymentsTable.finalizedAt, to));

    const rows = await db
      .select({
        currency: paymentsTable.currency,
        category: CATEGORY_CASE,
        provider: paymentsTable.provider,
        grossSubunits: sql<string>`COALESCE(SUM(${paymentsTable.amountSubunits}), 0)`,
        transactions: sql<string>`COUNT(*)`,
      })
      .from(paymentsTable)
      .where(and(...conds))
      .groupBy(paymentsTable.currency, CATEGORY_CASE, paymentsTable.provider);

    // Pivot the flat group-by result into a per-currency structure
    // that's friendly to the dashboard (totals + per-category +
    // per-provider).
    type CategoryKey = "candidate" | "institution" | "employer" | "other";
    type ProviderKey = "stripe" | "paystack";
    interface CurrencyAgg {
      currency: string;
      grossSubunits: number;
      transactions: number;
      byCategory: Record<
        CategoryKey,
        { grossSubunits: number; transactions: number }
      >;
      byProvider: Record<
        ProviderKey,
        { grossSubunits: number; transactions: number }
      >;
    }
    const blankCat = (): CurrencyAgg["byCategory"] => ({
      candidate: { grossSubunits: 0, transactions: 0 },
      institution: { grossSubunits: 0, transactions: 0 },
      employer: { grossSubunits: 0, transactions: 0 },
      other: { grossSubunits: 0, transactions: 0 },
    });
    const blankProv = (): CurrencyAgg["byProvider"] => ({
      stripe: { grossSubunits: 0, transactions: 0 },
      paystack: { grossSubunits: 0, transactions: 0 },
    });

    const byCurrency = new Map<string, CurrencyAgg>();
    for (const r of rows) {
      const cur = r.currency;
      const cat = r.category as CategoryKey;
      const prov = (r.provider === "paystack" ? "paystack" : "stripe") as ProviderKey;
      const gross = Number(r.grossSubunits);
      const tx = Number(r.transactions);
      let agg = byCurrency.get(cur);
      if (!agg) {
        agg = {
          currency: cur,
          grossSubunits: 0,
          transactions: 0,
          byCategory: blankCat(),
          byProvider: blankProv(),
        };
        byCurrency.set(cur, agg);
      }
      agg.grossSubunits += gross;
      agg.transactions += tx;
      if (cat in agg.byCategory) {
        agg.byCategory[cat].grossSubunits += gross;
        agg.byCategory[cat].transactions += tx;
      }
      agg.byProvider[prov].grossSubunits += gross;
      agg.byProvider[prov].transactions += tx;
    }

    res.json({
      currencies: Array.from(byCurrency.values()).sort((a, b) =>
        b.grossSubunits - a.grossSubunits,
      ),
    });
  },
);

/**
 * GET /admin/revenue/timeseries?from=&to=&bucket=day
 *
 * Returns one point per (date bucket, currency, category) for the
 * line chart on the revenue dashboard. Defaults to the last 90 days
 * grouped by day. The unbounded form (no `from`) is intentionally
 * server-capped at 365 days to keep the chart payload bounded even
 * if a finance user opens the page without picking a range.
 */
router.get(
  "/admin/revenue/timeseries",
  requireAdmin,
  requirePermission("payments:view"),
  async (req, res) => {
    const { from: rawFrom, to: rawTo } = parseDateRange(req);
    const bucket =
      typeof req.query.bucket === "string" &&
      ["day", "week", "month"].includes(req.query.bucket)
        ? (req.query.bucket as "day" | "week" | "month")
        : "day";

    // Cap the window at 365 days when no explicit `from` is supplied
    // so the un-filtered "first time you open the page" load stays
    // fast even on a busy tenant.
    const to = rawTo ?? new Date();
    const defaultDays = bucket === "month" ? 365 : bucket === "week" ? 365 : 90;
    const from =
      rawFrom ??
      new Date(to.getTime() - defaultDays * 24 * 60 * 60 * 1000);

    const truncExpr = sql<Date>`DATE_TRUNC(${bucket}, ${paymentsTable.finalizedAt})`;

    const rows = await db
      .select({
        bucketStart: truncExpr,
        currency: paymentsTable.currency,
        category: CATEGORY_CASE,
        grossSubunits: sql<string>`COALESCE(SUM(${paymentsTable.amountSubunits}), 0)`,
        transactions: sql<string>`COUNT(*)`,
      })
      .from(paymentsTable)
      .where(
        and(
          inArray(paymentsTable.status, REVENUE_STATUSES),
          gte(paymentsTable.finalizedAt, from),
          lte(paymentsTable.finalizedAt, to),
        ),
      )
      .groupBy(truncExpr, paymentsTable.currency, CATEGORY_CASE)
      .orderBy(truncExpr);

    res.json({
      bucket,
      from: from.toISOString(),
      to: to.toISOString(),
      points: rows.map((r) => ({
        bucketStart:
          r.bucketStart instanceof Date
            ? r.bucketStart.toISOString()
            : new Date(r.bucketStart as unknown as string).toISOString(),
        currency: r.currency,
        category: r.category,
        grossSubunits: Number(r.grossSubunits),
        transactions: Number(r.transactions),
      })),
    });
  },
);

/**
 * GET /admin/payments
 *
 * Lists individual rows from the unified `payments` ledger so the
 * admin payments console can reconcile a Stripe vs Paystack
 * transaction by hand. Supports `provider`, `status`, `purposeType`
 * filters; limit is server-capped at 100 to keep the console
 * responsive even on busy tenants.
 */
router.get(
  "/admin/payments",
  requireAdmin,
  requirePermission("payments:view"),
  async (req, res) => {
    const conds = [];
    const { provider, status, purposeType } = req.query as Record<
      string,
      unknown
    >;
    if (typeof provider === "string" && provider.length > 0) {
      conds.push(eq(paymentsTable.provider, provider));
    }
    if (typeof status === "string" && status.length > 0) {
      conds.push(eq(paymentsTable.status, status));
    }
    if (typeof purposeType === "string" && purposeType.length > 0) {
      conds.push(eq(paymentsTable.purposeType, purposeType));
    }
    const rawLimit = Number((req.query as { limit?: unknown }).limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : 50;

    const rows = await db
      .select()
      .from(paymentsTable)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(paymentsTable.id))
      .limit(limit);

    res.json({
      payments: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        externalRef: r.externalRef,
        purposeType: r.purposeType,
        purposeId: r.purposeId,
        amountSubunits: r.amountSubunits,
        currency: r.currency,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        finalizedAt: r.finalizedAt ? r.finalizedAt.toISOString() : null,
      })),
    });
  },
);

/**
 * POST /admin/payments/:id/refinalize
 *
 * Manually re-runs the finalizer for a single payment ledger row.
 * This is the reconciliation lever finance uses when a webhook was
 * never received (provider outage, signature mismatch, etc.) — it's
 * idempotent because the underlying flow finalizers no-op when the
 * per-flow row is already `paid`/`active`. Routes by the row's own
 * `provider` so it works for both Stripe and Paystack.
 */
router.post(
  "/admin/payments/:id/refinalize",
  requireAdmin,
  requirePermission("payments:view"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid payment id" });
      return;
    }
    const [row] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    const dispatch =
      row.provider === "paystack"
        ? finalizeFromPaystackReference(row.externalRef)
        : finalizeFromStripeSessionId(row.externalRef);
    const { flow, result } = await dispatch;
    res.json({
      provider: row.provider,
      externalRef: row.externalRef,
      flow,
      alreadyFinalized: result?.alreadyFinalized ?? false,
      reconciled: result != null && !result.notFound,
    });
  },
);

export default router;
