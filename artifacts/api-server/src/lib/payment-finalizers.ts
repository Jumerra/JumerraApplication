import { and, eq } from "drizzle-orm";
import {
  db,
  boostPaymentsTable,
  candidatesTable,
  cvPaymentsTable,
  jobTierPaymentsTable,
  jobsTable,
  institutionSubscriptionsTable,
  employerSubscriptionsTable,
  paymentsTable,
} from "@workspace/db";
import { getUncachableStripeClient } from "../stripeClient";
import { logger } from "./logger";

/**
 * Upsert a row into the unified `payments` ledger so admins can query
 * "all paid payments across all five flows" with a single SELECT.
 * Called by every finalizer on successful flip. The (provider,
 * externalRef) pair is the unique key so retries are no-ops.
 */
async function recordUnifiedPayment(args: {
  provider: "stripe" | "paystack";
  externalRef: string;
  purposeType:
    | "boost"
    | "cv"
    | "job_tier"
    | "institution_subscription"
    | "employer_subscription";
  purposeId: number;
  amountSubunits: number;
  currency: string;
  status: string;
}) {
  await db
    .insert(paymentsTable)
    .values({
      provider: args.provider,
      externalRef: args.externalRef,
      purposeType: args.purposeType,
      purposeId: args.purposeId,
      amountSubunits: args.amountSubunits,
      currency: args.currency,
      status: args.status,
      finalizedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [paymentsTable.provider, paymentsTable.externalRef],
      set: {
        status: args.status,
        finalizedAt: new Date(),
      },
    });
}

/**
 * Shared, idempotent finalizers for every paywalled flow. Used by:
 *  - the user-driven `/verify` endpoints (when the buyer returns to
 *    the success URL), and
 *  - the provider-driven webhook handlers (the safety net that catches
 *    payments where the buyer closed the browser before redirect).
 *
 * Each finalizer:
 *  1. Looks up the payment row by either Stripe session id or Paystack
 *     reference (only one is populated per row).
 *  2. No-ops if the row is missing or already finalized.
 *  3. Otherwise runs the unlock/upgrade work inside a single DB
 *     transaction along with the `status -> paid|active|trialing` flip,
 *     so a mid-flight crash can never leave a paid payment with an
 *     unflipped unlock.
 *
 * Returns `{ alreadyFinalized: boolean, paymentId: number | null }`
 * so callers can log idempotency hits.
 */

export interface FinalizeContext {
  provider: "stripe" | "paystack";
  externalRef: string; // Stripe checkout session id OR Paystack reference
}

interface FinalizeResult {
  alreadyFinalized: boolean;
  paymentId: number | null;
  notFound?: boolean;
}

async function findBoostPayment(ctx: FinalizeContext) {
  const col =
    ctx.provider === "stripe"
      ? boostPaymentsTable.stripeSessionId
      : boostPaymentsTable.paystackReference;
  const rows = await db
    .select()
    .from(boostPaymentsTable)
    .where(eq(col, ctx.externalRef))
    .limit(1);
  return rows[0] ?? null;
}

async function findCvPayment(ctx: FinalizeContext) {
  const col =
    ctx.provider === "stripe"
      ? cvPaymentsTable.stripeSessionId
      : cvPaymentsTable.paystackReference;
  const rows = await db
    .select()
    .from(cvPaymentsTable)
    .where(eq(col, ctx.externalRef))
    .limit(1);
  return rows[0] ?? null;
}

async function findJobTierPayment(ctx: FinalizeContext) {
  const col =
    ctx.provider === "stripe"
      ? jobTierPaymentsTable.stripeSessionId
      : jobTierPaymentsTable.paystackReference;
  const rows = await db
    .select()
    .from(jobTierPaymentsTable)
    .where(eq(col, ctx.externalRef))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Finalize a one-shot boost purchase. Stacks duration onto any
 * existing future expiry so a candidate who pays twice in a row gets
 * the full time they paid for.
 */
export async function finalizeBoostPayment(
  ctx: FinalizeContext,
): Promise<FinalizeResult> {
  const payment = await findBoostPayment(ctx);
  if (!payment) return { alreadyFinalized: false, paymentId: null, notFound: true };
  if (payment.status !== "pending") {
    return { alreadyFinalized: true, paymentId: payment.id };
  }
  await db.transaction(async (tx) => {
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
    if (flipped.length === 0) return;

    const cand = await tx
      .select({ boostExpiresAt: candidatesTable.boostExpiresAt })
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
  });
  await recordUnifiedPayment({
    provider: ctx.provider,
    externalRef: ctx.externalRef,
    purposeType: "boost",
    purposeId: payment.id,
    amountSubunits: payment.amountCents,
    currency: payment.currency,
    status: "paid",
  });
  return { alreadyFinalized: false, paymentId: payment.id };
}

/**
 * Finalize a CV unlock. The unlock + status flip happen in the same
 * transaction — the previous /verify implementation flipped status and
 * candidate flag in two separate queries, so a crash between them
 * could leave a paid CV payment unlinked from the candidate's
 * `aiCvUnlocked` flag.
 */
export async function finalizeCvPayment(
  ctx: FinalizeContext,
): Promise<FinalizeResult> {
  const payment = await findCvPayment(ctx);
  if (!payment) return { alreadyFinalized: false, paymentId: null, notFound: true };
  if (payment.status !== "pending") {
    return { alreadyFinalized: true, paymentId: payment.id };
  }
  await db.transaction(async (tx) => {
    const flipped = await tx
      .update(cvPaymentsTable)
      .set({ status: "paid", paidAt: new Date() })
      .where(
        and(
          eq(cvPaymentsTable.id, payment.id),
          eq(cvPaymentsTable.status, "pending"),
        ),
      )
      .returning({ id: cvPaymentsTable.id });
    if (flipped.length === 0) return;
    await tx
      .update(candidatesTable)
      .set({ aiCvUnlocked: true, aiCvUnlockedAt: new Date() })
      .where(eq(candidatesTable.id, payment.candidateId));
  });
  await recordUnifiedPayment({
    provider: ctx.provider,
    externalRef: ctx.externalRef,
    purposeType: "cv",
    purposeId: payment.id,
    amountSubunits: payment.amountCents,
    currency: payment.currency,
    status: "paid",
  });
  return { alreadyFinalized: false, paymentId: payment.id };
}

/**
 * Finalize a job-tier promotion. Mirrors the existing /verify logic:
 * stack onto existing same-tier expiry, otherwise start fresh.
 */
export async function finalizeJobTierPayment(
  ctx: FinalizeContext,
): Promise<FinalizeResult> {
  const payment = await findJobTierPayment(ctx);
  if (!payment) return { alreadyFinalized: false, paymentId: null, notFound: true };
  if (payment.status !== "pending") {
    return { alreadyFinalized: true, paymentId: payment.id };
  }
  await db.transaction(async (tx) => {
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
    if (flipped.length === 0) return;
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
  });
  await recordUnifiedPayment({
    provider: ctx.provider,
    externalRef: ctx.externalRef,
    purposeType: "job_tier",
    purposeId: payment.id,
    amountSubunits: payment.amountCents,
    currency: payment.currency,
    status: "paid",
  });
  return { alreadyFinalized: false, paymentId: payment.id };
}

/**
 * Apply a Stripe subscription state update (from invoice.paid,
 * customer.subscription.updated, or customer.subscription.deleted)
 * to whichever of `institution_subscriptions` or
 * `employer_subscriptions` owns it. Runs inside a single transaction
 * so the status flip + period dates are written atomically. Returns
 * the rowId+table or null when no local row matches (the sub belongs
 * to a different system or hasn't been persisted yet).
 */
export async function applyStripeSubscriptionUpdate(sub: {
  id: string;
  status: string;
  trial_end: number | null;
  current_period_end?: number;
  customer: string | { id: string } | null;
  items?: { data?: Array<{ current_period_end?: number }> };
}): Promise<{ table: "institution" | "employer"; rowId: number } | null> {
  const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  const periodEndUnix =
    sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  let mapped: "trialing" | "active" | "canceled" | "expired" | "failed" =
    "failed";
  if (sub.status === "trialing") mapped = "trialing";
  else if (sub.status === "active") mapped = "active";
  else if (sub.status === "canceled") mapped = "canceled";
  else if (sub.status === "incomplete_expired" || sub.status === "unpaid")
    mapped = "expired";
  else if (sub.status === "past_due" || sub.status === "paused")
    mapped = "expired";
  else if (sub.status === "incomplete") return null;

  // Try institution table first.
  const inst = await db
    .select({ id: institutionSubscriptionsTable.id })
    .from(institutionSubscriptionsTable)
    .where(eq(institutionSubscriptionsTable.stripeSubscriptionId, sub.id))
    .limit(1);
  if (inst[0]) {
    await db
      .update(institutionSubscriptionsTable)
      .set({
        status: mapped,
        stripeCustomerId: customerId,
        trialEndsAt,
        ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
        updatedAt: new Date(),
        ...(mapped === "canceled" ? { canceledAt: new Date() } : {}),
      })
      .where(eq(institutionSubscriptionsTable.id, inst[0].id));
    return { table: "institution", rowId: inst[0].id };
  }
  const emp = await db
    .select({ id: employerSubscriptionsTable.id })
    .from(employerSubscriptionsTable)
    .where(eq(employerSubscriptionsTable.stripeSubscriptionId, sub.id))
    .limit(1);
  if (emp[0]) {
    await db
      .update(employerSubscriptionsTable)
      .set({
        status: mapped,
        stripeCustomerId: customerId,
        trialEndsAt,
        ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
        updatedAt: new Date(),
        ...(mapped === "canceled" ? { canceledAt: new Date() } : {}),
      })
      .where(eq(employerSubscriptionsTable.id, emp[0].id));
    return { table: "employer", rowId: emp[0].id };
  }
  return null;
}

/**
 * Mark a subscription canceled (terminal). Used by
 * customer.subscription.deleted which doesn't always carry an items
 * array.
 */
export async function markStripeSubscriptionCanceled(
  subscriptionId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(institutionSubscriptionsTable)
    .set({ status: "canceled", canceledAt: now, updatedAt: now })
    .where(eq(institutionSubscriptionsTable.stripeSubscriptionId, subscriptionId));
  await db
    .update(employerSubscriptionsTable)
    .set({ status: "canceled", canceledAt: now, updatedAt: now })
    .where(eq(employerSubscriptionsTable.stripeSubscriptionId, subscriptionId));
}

/**
 * Finalize an institution-subscription Stripe checkout. Walks the
 * Stripe subscription to capture trial_end / current_period_end and
 * updates the row to trialing/active accordingly. Paystack
 * subscriptions are not yet wired (deferred — see replit.md).
 */
export async function finalizeInstitutionSubscriptionFromStripe(
  sessionId: string,
): Promise<FinalizeResult> {
  const rows = await db
    .select()
    .from(institutionSubscriptionsTable)
    .where(eq(institutionSubscriptionsTable.stripeCheckoutSessionId, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return { alreadyFinalized: false, paymentId: null, notFound: true };
  if (row.status !== "pending") {
    return { alreadyFinalized: true, paymentId: row.id };
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
          items?: { data?: Array<{ current_period_end?: number }> };
        })
      : null;
  if (!sub) {
    logger.warn({ sessionId }, "stripe webhook: subscription not yet attached");
    return { alreadyFinalized: false, paymentId: row.id };
  }
  let mapped: "trialing" | "active" | "canceled" | "expired" | "failed" =
    "failed";
  if (sub.status === "trialing") mapped = "trialing";
  else if (sub.status === "active") mapped = "active";
  else if (sub.status === "canceled") mapped = "canceled";
  else if (sub.status === "incomplete_expired" || sub.status === "unpaid")
    mapped = "expired";
  else if (sub.status === "past_due" || sub.status === "paused")
    mapped = "expired";
  else if (sub.status === "incomplete") return { alreadyFinalized: false, paymentId: row.id };
  const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  const periodEndUnix =
    sub.current_period_end ??
    sub.items?.data?.[0]?.current_period_end ??
    null;
  if (!periodEndUnix) return { alreadyFinalized: false, paymentId: row.id };
  const currentPeriodEnd = new Date(periodEndUnix * 1000);
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
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
  await recordUnifiedPayment({
    provider: "stripe",
    externalRef: sessionId,
    purposeType: "institution_subscription",
    purposeId: row.id,
    amountSubunits: row.priceCentsSnapshot,
    currency: row.currencySnapshot,
    status: mapped,
  });
  return { alreadyFinalized: false, paymentId: row.id };
}

/**
 * Finalize an institution-subscription Paystack transaction.
 *
 * Paystack does not model recurring subscriptions through our thin
 * client (the Plan API is intentionally not wired). We treat the
 * checkout as a one-shot charge that covers one `intervalDays`
 * period: on success we flip to `active` and stamp
 * `currentPeriodEnd = now + intervalDaysSnapshot`. Renewal is a
 * future explicit checkout.
 *
 * Idempotent: a row already past `pending` short-circuits. The
 * unified payments ledger insert uses (provider, externalRef) as the
 * unique key so webhook + verify can both run safely.
 */
export async function finalizeInstitutionSubscriptionFromPaystack(
  reference: string,
): Promise<FinalizeResult> {
  const rows = await db
    .select()
    .from(institutionSubscriptionsTable)
    .where(eq(institutionSubscriptionsTable.paystackReference, reference))
    .limit(1);
  const row = rows[0];
  if (!row) return { alreadyFinalized: false, paymentId: null, notFound: true };
  if (row.status !== "pending") {
    return { alreadyFinalized: true, paymentId: row.id };
  }
  const now = new Date();
  const periodEnd = new Date(
    now.getTime() + row.intervalDaysSnapshot * 24 * 60 * 60 * 1000,
  );
  await db
    .update(institutionSubscriptionsTable)
    .set({
      status: "active",
      currentPeriodEnd: periodEnd,
      startedAt: row.startedAt ?? now,
      updatedAt: now,
    })
    .where(
      and(
        eq(institutionSubscriptionsTable.id, row.id),
        eq(institutionSubscriptionsTable.status, "pending"),
      ),
    );
  await recordUnifiedPayment({
    provider: "paystack",
    externalRef: reference,
    purposeType: "institution_subscription",
    purposeId: row.id,
    amountSubunits: row.priceCentsSnapshot,
    currency: row.currencySnapshot,
    status: "active",
  });
  return { alreadyFinalized: false, paymentId: row.id };
}

/**
 * Same shape as the institution variant but for employer subscriptions.
 * Recurring employer subs are formally deprecated (the /checkout route
 * returns 410) but historical rows still need to be finalized correctly
 * if a Stripe retry lands.
 */
export async function finalizeEmployerSubscriptionFromStripe(
  sessionId: string,
): Promise<FinalizeResult> {
  const rows = await db
    .select()
    .from(employerSubscriptionsTable)
    .where(eq(employerSubscriptionsTable.stripeCheckoutSessionId, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return { alreadyFinalized: false, paymentId: null, notFound: true };
  if (row.status !== "pending") {
    return { alreadyFinalized: true, paymentId: row.id };
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
          items?: { data?: Array<{ current_period_end?: number }> };
        })
      : null;
  if (!sub) return { alreadyFinalized: false, paymentId: row.id };
  let mapped: "trialing" | "active" | "canceled" | "expired" | "failed" =
    "failed";
  if (sub.status === "trialing") mapped = "trialing";
  else if (sub.status === "active") mapped = "active";
  else if (sub.status === "canceled") mapped = "canceled";
  else if (sub.status === "incomplete_expired" || sub.status === "unpaid")
    mapped = "expired";
  else if (sub.status === "past_due" || sub.status === "paused")
    mapped = "expired";
  else if (sub.status === "incomplete") return { alreadyFinalized: false, paymentId: row.id };
  const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  const periodEndUnix =
    sub.current_period_end ??
    sub.items?.data?.[0]?.current_period_end ??
    null;
  if (!periodEndUnix) return { alreadyFinalized: false, paymentId: row.id };
  const currentPeriodEnd = new Date(periodEndUnix * 1000);
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
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
  await recordUnifiedPayment({
    provider: "stripe",
    externalRef: sessionId,
    purposeType: "employer_subscription",
    purposeId: row.id,
    amountSubunits: row.priceCentsSnapshot,
    currency: row.currencySnapshot,
    status: mapped,
  });
  return { alreadyFinalized: false, paymentId: row.id };
}

/**
 * Route a Stripe checkout.session.completed event to the right
 * finalizer by walking each payment table until we find a match. This
 * keeps webhook routing simple — we don't have to trust the metadata
 * we set at create time to know which flow this was.
 */
export async function finalizeFromStripeSessionId(
  sessionId: string,
): Promise<{ flow: string | null; result: FinalizeResult | null }> {
  // One-shots first — cheapest lookups.
  const ctx: FinalizeContext = { provider: "stripe", externalRef: sessionId };
  const boost = await finalizeBoostPayment(ctx);
  if (!boost.notFound) return { flow: "boost", result: boost };
  const cv = await finalizeCvPayment(ctx);
  if (!cv.notFound) return { flow: "cv", result: cv };
  const jt = await finalizeJobTierPayment(ctx);
  if (!jt.notFound) return { flow: "job_tier", result: jt };
  // Subscriptions (need Stripe fetch).
  const inst = await finalizeInstitutionSubscriptionFromStripe(sessionId);
  if (!inst.notFound) return { flow: "institution_subscription", result: inst };
  const emp = await finalizeEmployerSubscriptionFromStripe(sessionId);
  if (!emp.notFound) return { flow: "employer_subscription", result: emp };
  return { flow: null, result: null };
}

/**
 * Route a Paystack reference to the right finalizer. One-shots are
 * cheapest so we walk them first. Institution subscriptions use a
 * one-shot-per-period model on the Paystack rail (see
 * `finalizeInstitutionSubscriptionFromPaystack`). The employer
 * subscription Plan API is still not wired.
 */
export async function finalizeFromPaystackReference(
  reference: string,
): Promise<{ flow: string | null; result: FinalizeResult | null }> {
  const ctx: FinalizeContext = { provider: "paystack", externalRef: reference };
  const boost = await finalizeBoostPayment(ctx);
  if (!boost.notFound) return { flow: "boost", result: boost };
  const cv = await finalizeCvPayment(ctx);
  if (!cv.notFound) return { flow: "cv", result: cv };
  const jt = await finalizeJobTierPayment(ctx);
  if (!jt.notFound) return { flow: "job_tier", result: jt };
  const inst = await finalizeInstitutionSubscriptionFromPaystack(reference);
  if (!inst.notFound) return { flow: "institution_subscription", result: inst };
  return { flow: null, result: null };
}
