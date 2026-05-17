import { Router } from "express";
import {
  db,
  paymentsTable,
  boostPaymentsTable,
  cvPaymentsTable,
  jobTierPaymentsTable,
  institutionSubscriptionsTable,
  employerSubscriptionsTable,
  candidatesTable,
  employersTable,
  institutionsTable,
} from "@workspace/db";
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
const CATEGORY_PURPOSE_TYPES: Record<string, string[]> = {
  candidate: ["boost", "cv"],
  institution: ["institution_subscription"],
  employer: ["job_tier", "employer_subscription"],
};

router.get(
  "/admin/payments",
  requireAdmin,
  requirePermission("payments:view"),
  async (req, res) => {
    const conds = [];
    const { provider, status, purposeType, currency, category } =
      req.query as Record<string, unknown>;
    if (typeof provider === "string" && provider.length > 0) {
      conds.push(eq(paymentsTable.provider, provider));
    }
    if (typeof status === "string" && status.length > 0) {
      conds.push(eq(paymentsTable.status, status));
    }
    if (typeof purposeType === "string" && purposeType.length > 0) {
      conds.push(eq(paymentsTable.purposeType, purposeType));
    }
    if (typeof currency === "string" && currency.length > 0) {
      // The unified `payments` table stores currency in the form the
      // upstream provider sent it (uppercase ISO 4217 — "USD", "NGN").
      // The admin page input is free-text and users may type either
      // case, so normalize to uppercase here for a stable compare.
      conds.push(eq(paymentsTable.currency, currency.toUpperCase()));
    }
    if (
      typeof category === "string" &&
      category.length > 0 &&
      CATEGORY_PURPOSE_TYPES[category]
    ) {
      conds.push(
        inArray(paymentsTable.purposeType, CATEGORY_PURPOSE_TYPES[category]),
      );
    }
    const { from, to } = parseDateRange(req);
    if (from) conds.push(gte(paymentsTable.finalizedAt, from));
    if (to) conds.push(lte(paymentsTable.finalizedAt, to));

    const rawLimit = Number((req.query as { limit?: unknown }).limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : 50;
    const rawOffset = Number((req.query as { offset?: unknown }).offset);
    const offset =
      Number.isFinite(rawOffset) && rawOffset > 0
        ? Math.min(rawOffset, 100_000)
        : 0;

    // The polymorphic `payments.purpose_id` points at one of five
    // per-flow tables, which in turn point at one of three customer
    // tables (candidates / employers / institutions). Resolving the
    // customer name in a single round trip would require a 5-way
    // CASE-driven join graph that drizzle's typed builder isn't
    // great at expressing; instead we fetch the page first, then
    // batch-resolve each per-flow table once with a single IN-list
    // query. The page is capped at 100 so this is at most 5 small
    // round-trips regardless of payment volume.
    const rows = await db
      .select()
      .from(paymentsTable)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(paymentsTable.id))
      .limit(limit)
      .offset(offset);

    const customers = await resolveCustomers(rows);

    res.json({
      payments: rows.map((r) => {
        const c = customers.get(`${r.purposeType}:${r.purposeId}`) ?? null;
        return {
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
          customerType: c?.type ?? null,
          customerId: c?.id ?? null,
          customerName: c?.name ?? null,
          customerDeepLink: c?.deepLink ?? null,
        };
      }),
    });
  },
);

/**
 * GET /admin/payments.csv
 *
 * Streams the same filtered view as `GET /admin/payments` but as a
 * CSV download so finance can reconcile a month's payments against
 * Stripe/Paystack statements in a spreadsheet. Server-capped at
 * 10k rows — anything larger should be narrowed by from/to first.
 *
 * Each row carries the amount twice:
 *   - `amount_subunits` — integer cents/kobo (safe for re-aggregation)
 *   - `amount_major`    — currency-aware decimal string formatted with
 *                         Intl.NumberFormat (matches what the console
 *                         shows in the Amount column)
 */
const CSV_EXPORT_CAP = 10_000;

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function categoryOf(purposeType: string): string {
  if (purposeType === "boost" || purposeType === "cv") return "candidate";
  if (purposeType === "institution_subscription") return "institution";
  if (purposeType === "job_tier" || purposeType === "employer_subscription")
    return "employer";
  return "other";
}

function formatMajor(subunits: number, currency: string): string {
  const major = subunits / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency.toUpperCase()} ${major.toFixed(2)}`;
  }
}

router.get(
  "/admin/payments.csv",
  requireAdmin,
  requirePermission("payments:view"),
  async (req, res) => {
    const conds = [];
    const { provider, status, purposeType, currency, category } =
      req.query as Record<string, unknown>;
    if (typeof provider === "string" && provider.length > 0) {
      conds.push(eq(paymentsTable.provider, provider));
    }
    if (typeof status === "string" && status.length > 0) {
      conds.push(eq(paymentsTable.status, status));
    }
    if (typeof purposeType === "string" && purposeType.length > 0) {
      conds.push(eq(paymentsTable.purposeType, purposeType));
    }
    if (typeof currency === "string" && currency.length > 0) {
      conds.push(eq(paymentsTable.currency, currency.toLowerCase()));
    }
    if (
      typeof category === "string" &&
      category.length > 0 &&
      CATEGORY_PURPOSE_TYPES[category]
    ) {
      conds.push(
        inArray(paymentsTable.purposeType, CATEGORY_PURPOSE_TYPES[category]),
      );
    }
    const { from, to } = parseDateRange(req);
    if (from) conds.push(gte(paymentsTable.finalizedAt, from));
    if (to) conds.push(lte(paymentsTable.finalizedAt, to));

    const rows = await db
      .select()
      .from(paymentsTable)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(paymentsTable.id))
      .limit(CSV_EXPORT_CAP);

    const today = new Date();
    const yyyymmdd =
      today.getUTCFullYear().toString().padStart(4, "0") +
      (today.getUTCMonth() + 1).toString().padStart(2, "0") +
      today.getUTCDate().toString().padStart(2, "0");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payments-${yyyymmdd}.csv"`,
    );
    res.setHeader("Cache-Control", "no-store");

    const header = [
      "id",
      "provider",
      "external_ref",
      "purpose_type",
      "category",
      "purpose_id",
      "amount_subunits",
      "amount_major",
      "currency",
      "status",
      "created_at",
      "finalized_at",
    ].join(",");
    res.write(header + "\r\n");

    for (const r of rows) {
      const line = [
        r.id,
        csvEscape(r.provider),
        csvEscape(r.externalRef),
        csvEscape(r.purposeType),
        csvEscape(categoryOf(r.purposeType)),
        csvEscape(r.purposeId),
        r.amountSubunits,
        csvEscape(formatMajor(r.amountSubunits, r.currency)),
        csvEscape(r.currency),
        csvEscape(r.status),
        r.createdAt.toISOString(),
        r.finalizedAt ? r.finalizedAt.toISOString() : "",
      ].join(",");
      res.write(line + "\r\n");
    }
    res.end();
  },
);

/**
 * Resolve the customer (candidate / employer / institution) behind a
 * batch of `payments` rows. Returns a map keyed by
 * `${purposeType}:${purposeId}` so callers can render the resolved
 * customer next to the raw ledger row.
 *
 * Strategy: bucket purpose_ids by their per-flow table, fire one
 * query per bucket to look up the customer id, then one query per
 * customer table to resolve names. At most 5 + 3 round-trips for a
 * page of up to 100 ledger rows.
 */
type ResolvedCustomer = {
  type: "candidate" | "employer" | "institution";
  id: number;
  name: string;
  deepLink: string;
};

async function resolveCustomers(
  rows: Array<{ purposeType: string; purposeId: number | null }>,
): Promise<Map<string, ResolvedCustomer>> {
  const boostIds = new Set<number>();
  const cvIds = new Set<number>();
  const jobTierIds = new Set<number>();
  const instSubIds = new Set<number>();
  const empSubIds = new Set<number>();
  for (const r of rows) {
    if (r.purposeId == null) continue;
    switch (r.purposeType) {
      case "boost":
        boostIds.add(r.purposeId);
        break;
      case "cv":
        cvIds.add(r.purposeId);
        break;
      case "job_tier":
        jobTierIds.add(r.purposeId);
        break;
      case "institution_subscription":
        instSubIds.add(r.purposeId);
        break;
      case "employer_subscription":
        empSubIds.add(r.purposeId);
        break;
    }
  }

  // purposeId -> customerId per flow
  const boostMap = new Map<number, number>();
  const cvMap = new Map<number, number>();
  const jobTierMap = new Map<number, number>();
  const instSubMap = new Map<number, number>();
  const empSubMap = new Map<number, number>();

  await Promise.all([
    boostIds.size > 0
      ? db
          .select({
            id: boostPaymentsTable.id,
            candidateId: boostPaymentsTable.candidateId,
          })
          .from(boostPaymentsTable)
          .where(inArray(boostPaymentsTable.id, Array.from(boostIds)))
          .then((rs) => rs.forEach((r) => boostMap.set(r.id, r.candidateId)))
      : Promise.resolve(),
    cvIds.size > 0
      ? db
          .select({
            id: cvPaymentsTable.id,
            candidateId: cvPaymentsTable.candidateId,
          })
          .from(cvPaymentsTable)
          .where(inArray(cvPaymentsTable.id, Array.from(cvIds)))
          .then((rs) => rs.forEach((r) => cvMap.set(r.id, r.candidateId)))
      : Promise.resolve(),
    jobTierIds.size > 0
      ? db
          .select({
            id: jobTierPaymentsTable.id,
            employerId: jobTierPaymentsTable.employerId,
          })
          .from(jobTierPaymentsTable)
          .where(inArray(jobTierPaymentsTable.id, Array.from(jobTierIds)))
          .then((rs) => rs.forEach((r) => jobTierMap.set(r.id, r.employerId)))
      : Promise.resolve(),
    instSubIds.size > 0
      ? db
          .select({
            id: institutionSubscriptionsTable.id,
            institutionId: institutionSubscriptionsTable.institutionId,
          })
          .from(institutionSubscriptionsTable)
          .where(
            inArray(institutionSubscriptionsTable.id, Array.from(instSubIds)),
          )
          .then((rs) =>
            rs.forEach((r) => instSubMap.set(r.id, r.institutionId)),
          )
      : Promise.resolve(),
    empSubIds.size > 0
      ? db
          .select({
            id: employerSubscriptionsTable.id,
            employerId: employerSubscriptionsTable.employerId,
          })
          .from(employerSubscriptionsTable)
          .where(
            inArray(employerSubscriptionsTable.id, Array.from(empSubIds)),
          )
          .then((rs) => rs.forEach((r) => empSubMap.set(r.id, r.employerId)))
      : Promise.resolve(),
  ]);

  const candidateIds = new Set<number>();
  for (const v of boostMap.values()) candidateIds.add(v);
  for (const v of cvMap.values()) candidateIds.add(v);
  const employerIds = new Set<number>();
  for (const v of jobTierMap.values()) employerIds.add(v);
  for (const v of empSubMap.values()) employerIds.add(v);
  const institutionIds = new Set<number>();
  for (const v of instSubMap.values()) institutionIds.add(v);

  const candidateNames = new Map<number, string>();
  const employerNames = new Map<number, string>();
  const institutionNames = new Map<number, string>();

  await Promise.all([
    candidateIds.size > 0
      ? db
          .select({
            id: candidatesTable.id,
            fullName: candidatesTable.fullName,
          })
          .from(candidatesTable)
          .where(inArray(candidatesTable.id, Array.from(candidateIds)))
          .then((rs) =>
            rs.forEach((r) => candidateNames.set(r.id, r.fullName)),
          )
      : Promise.resolve(),
    employerIds.size > 0
      ? db
          .select({ id: employersTable.id, name: employersTable.name })
          .from(employersTable)
          .where(inArray(employersTable.id, Array.from(employerIds)))
          .then((rs) => rs.forEach((r) => employerNames.set(r.id, r.name)))
      : Promise.resolve(),
    institutionIds.size > 0
      ? db
          .select({ id: institutionsTable.id, name: institutionsTable.name })
          .from(institutionsTable)
          .where(inArray(institutionsTable.id, Array.from(institutionIds)))
          .then((rs) =>
            rs.forEach((r) => institutionNames.set(r.id, r.name)),
          )
      : Promise.resolve(),
  ]);

  const out = new Map<string, ResolvedCustomer>();
  // These detail pages exist as public profile/record routes on the
  // web app and are the most precise "jump to this customer" target
  // we have today. Each is one row → one URL, so support can land
  // directly on the record without searching.
  const candidateLink = (id: number) => `/candidates/${id}`;
  const employerLink = (id: number) => `/employers/${id}`;
  const institutionLink = (id: number) => `/institutions/${id}`;

  for (const r of rows) {
    if (r.purposeId == null) continue;
    const key = `${r.purposeType}:${r.purposeId}`;
    let candidateId: number | undefined;
    let employerId: number | undefined;
    let institutionId: number | undefined;
    switch (r.purposeType) {
      case "boost":
        candidateId = boostMap.get(r.purposeId);
        break;
      case "cv":
        candidateId = cvMap.get(r.purposeId);
        break;
      case "job_tier":
        employerId = jobTierMap.get(r.purposeId);
        break;
      case "institution_subscription":
        institutionId = instSubMap.get(r.purposeId);
        break;
      case "employer_subscription":
        employerId = empSubMap.get(r.purposeId);
        break;
    }
    if (candidateId != null) {
      const name = candidateNames.get(candidateId);
      if (name)
        out.set(key, {
          type: "candidate",
          id: candidateId,
          name,
          deepLink: candidateLink(candidateId),
        });
    } else if (employerId != null) {
      const name = employerNames.get(employerId);
      if (name)
        out.set(key, {
          type: "employer",
          id: employerId,
          name,
          deepLink: employerLink(employerId),
        });
    } else if (institutionId != null) {
      const name = institutionNames.get(institutionId);
      if (name)
        out.set(key, {
          type: "institution",
          id: institutionId,
          name,
          deepLink: institutionLink(institutionId),
        });
    }
  }
  return out;
}

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
