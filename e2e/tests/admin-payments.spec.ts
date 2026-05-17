import { test, expect } from "@playwright/test";
import { RUN_TAG } from "../helpers/env";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../helpers/constants";
import { login, ok } from "../helpers/api";
import {
  getBoostPaymentBySessionId,
  getPaymentLedgerRow,
  insertPendingBoostPayment,
} from "../helpers/db-helpers";
import {
  stripeSignature,
  stripeCheckoutCompletedEvent,
  paystackSignature,
  paystackChargeSuccessEvent,
} from "../helpers/webhooks";

/**
 * Journey 6: Admin payments console — list + manual re-finalize.
 *
 * We seed one Stripe USD boost row and one Paystack NGN boost row,
 * deliver each provider's signed webhook to finalize them, then:
 *   - GET /api/admin/payments?provider=stripe  → sees the Stripe row.
 *   - GET /api/admin/payments?provider=paystack → sees the Paystack row.
 *   - POST /api/admin/payments/:id/refinalize  → idempotent no-op
 *     (already finalized; safe for finance to click during recon).
 *
 * The re-finalize call is the recovery lever for the rare case where
 * the webhook never arrives (provider outage, signature mismatch,
 * etc.). The underlying flow finalizers no-op when the per-flow row
 * is already `paid`, so this is safe to run any number of times.
 */

async function seedCandidate(
  baseURL: string,
  email: string,
  password: string,
  fullName: string,
  playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"],
): Promise<number> {
  const ctx = await playwright.request.newContext({ baseURL });
  await ok(
    await ctx.post("/api/auth/register", {
      data: { email, password, role: "candidate", fullName },
    }),
    "register cand",
  );
  await login(ctx, email, password);
  const me = (await ok(await ctx.get("/api/auth/me"), "me")) as {
    user: { candidateId: number };
  };
  await ctx.dispose();
  return me.user.candidateId;
}

test("admin payments console: list + idempotent re-finalize across rails", async ({
  playwright,
}) => {
  const baseURL = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
  const tag = `${RUN_TAG}-adminpay`;

  // ── Seed: one Stripe boost, one Paystack boost. ──
  const stripeCandidateId = await seedCandidate(
    baseURL,
    `adminpay-s-${tag}@jumerra.test`,
    "AdminPay1!aA",
    `Stripe Cand ${tag}`,
    playwright,
  );
  const paystackCandidateId = await seedCandidate(
    baseURL,
    `adminpay-p-${tag}@jumerra.test`,
    "AdminPay1!aA",
    `Paystack Cand ${tag}`,
    playwright,
  );

  const stripeSessionId = `cs_test_adminpay_${tag}_${Date.now()}`;
  await insertPendingBoostPayment({
    candidateId: stripeCandidateId,
    externalRef: stripeSessionId,
    provider: "stripe",
    amount: 999,
    currency: "USD",
    durationDays: 30,
  });
  const paystackReference = `psk_ref_adminpay_${tag}_${Date.now()}`;
  await insertPendingBoostPayment({
    candidateId: paystackCandidateId,
    externalRef: paystackReference,
    provider: "paystack",
    paystackReference,
    amount: 500_000,
    currency: "NGN",
    durationDays: 30,
  });

  // ── Deliver both webhooks to populate the unified payments ledger. ──
  const whCtx = await playwright.request.newContext({ baseURL });
  const stripePayload = stripeCheckoutCompletedEvent({
    id: `evt_adminpay_s_${tag}_${Date.now()}`,
    sessionId: stripeSessionId,
    paymentStatus: "paid",
  });
  const stripeRes = await whCtx.post("/api/webhooks/stripe", {
    headers: {
      "stripe-signature": stripeSignature(stripePayload),
      "content-type": "application/json",
    },
    data: stripePayload,
  });
  expect(stripeRes.status()).toBe(200);

  const paystackPayload = paystackChargeSuccessEvent({
    reference: paystackReference,
    amount: 500_000,
    currency: "NGN",
  });
  const paystackRes = await whCtx.post("/api/webhooks/paystack", {
    headers: {
      "x-paystack-signature": paystackSignature(paystackPayload),
      "content-type": "application/json",
    },
    data: paystackPayload,
  });
  expect(paystackRes.status()).toBe(200);
  await whCtx.dispose();

  // Sanity: each underlying flow row + each ledger row is paid.
  const stripeBoost = await getBoostPaymentBySessionId(stripeSessionId);
  expect(stripeBoost!.status).toBe("paid");
  const paystackBoost = await getBoostPaymentBySessionId(paystackReference);
  expect(paystackBoost!.status).toBe("paid");
  const stripeLedger = await getPaymentLedgerRow("stripe", stripeSessionId);
  expect(stripeLedger!.status).toBe("paid");
  const paystackLedger = await getPaymentLedgerRow(
    "paystack",
    paystackReference,
  );
  expect(paystackLedger!.status).toBe("paid");

  // ── Admin can list + filter the payments console. ──
  const adminCtx = await playwright.request.newContext({ baseURL });
  await login(adminCtx, ADMIN_EMAIL, ADMIN_PASSWORD);

  type ConsoleRow = {
    id: number;
    provider: string;
    externalRef: string;
    purposeType: string;
    status: string;
    currency: string;
  };
  const allList = (await ok(
    await adminCtx.get(`/api/admin/payments?limit=100`),
    "admin list all payments",
  )) as { payments: ConsoleRow[] };
  expect(allList.payments.some((p) => p.externalRef === stripeSessionId)).toBe(
    true,
  );
  expect(
    allList.payments.some((p) => p.externalRef === paystackReference),
  ).toBe(true);

  const stripeOnly = (await ok(
    await adminCtx.get(`/api/admin/payments?provider=stripe&limit=100`),
    "admin list stripe-only",
  )) as { payments: ConsoleRow[] };
  expect(stripeOnly.payments.every((p) => p.provider === "stripe")).toBe(true);
  expect(
    stripeOnly.payments.some((p) => p.externalRef === stripeSessionId),
  ).toBe(true);
  expect(
    stripeOnly.payments.some((p) => p.externalRef === paystackReference),
  ).toBe(false);

  const paystackOnly = (await ok(
    await adminCtx.get(`/api/admin/payments?provider=paystack&limit=100`),
    "admin list paystack-only",
  )) as { payments: ConsoleRow[] };
  expect(
    paystackOnly.payments.every((p) => p.provider === "paystack"),
  ).toBe(true);
  expect(
    paystackOnly.payments.some((p) => p.externalRef === paystackReference),
  ).toBe(true);

  // ── Re-finalize is idempotent for both rails. ──
  const stripeRefin = (await ok(
    await adminCtx.post(
      `/api/admin/payments/${stripeLedger!.id}/refinalize`,
      { data: {} },
    ),
    "admin refinalize stripe",
  )) as {
    provider: string;
    flow: string | null;
    alreadyFinalized: boolean;
    reconciled: boolean;
  };
  expect(stripeRefin.provider).toBe("stripe");
  expect(stripeRefin.flow).toBe("boost");
  expect(stripeRefin.reconciled).toBe(true);
  expect(stripeRefin.alreadyFinalized).toBe(true);

  const paystackRefin = (await ok(
    await adminCtx.post(
      `/api/admin/payments/${paystackLedger!.id}/refinalize`,
      { data: {} },
    ),
    "admin refinalize paystack",
  )) as {
    provider: string;
    flow: string | null;
    alreadyFinalized: boolean;
    reconciled: boolean;
  };
  expect(paystackRefin.provider).toBe("paystack");
  expect(paystackRefin.flow).toBe("boost");
  expect(paystackRefin.reconciled).toBe(true);
  expect(paystackRefin.alreadyFinalized).toBe(true);

  // 404 on unknown id (sanity for the route's error path).
  const missing = await adminCtx.post(
    `/api/admin/payments/999999999/refinalize`,
    { data: {} },
  );
  expect(missing.status()).toBe(404);

  // Non-admin can't see the console (auth gate sanity).
  const candCtx = await playwright.request.newContext({ baseURL });
  await login(
    candCtx,
    `adminpay-s-${tag}@jumerra.test`,
    "AdminPay1!aA",
  );
  const candList = await candCtx.get(`/api/admin/payments`);
  expect([401, 403]).toContain(candList.status());
  await candCtx.dispose();
  await adminCtx.dispose();
});
