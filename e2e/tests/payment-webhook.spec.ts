import { test, expect } from "@playwright/test";
import { RUN_TAG } from "../helpers/env";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../helpers/constants";
import { login, ok } from "../helpers/api";
import {
  findUserByEmail,
  getCandidateById,
  getBoostPaymentBySessionId,
  insertPendingBoostPayment,
} from "../helpers/db-helpers";
import {
  stripeSignature,
  stripeCheckoutCompletedEvent,
  paystackSignature,
  paystackChargeSuccessEvent,
} from "../helpers/webhooks";

/**
 * Journey 4: Paid checkout -> webhook fires -> unlock confirmed in DB.
 *
 * We test BOTH rails (Stripe USD + Paystack NGN) against the boost flow
 * because:
 *   - It exercises the same finalizer dispatch that all other flows
 *     (CV unlock, job tier, subscriptions) route through.
 *   - The DB unlock side-effect (`candidates.isBoosted` + boost expiry)
 *     is easy to assert deterministically.
 *
 * We bypass the checkout-creation step (POST /candidates/:id/boost/checkout
 * would otherwise require talking to live Stripe/Paystack) by inserting
 * the pending payment row directly — this is the same row the real
 * checkout endpoint creates. The test then signs and POSTs the webhook
 * exactly as Stripe/Paystack would in production. The signature
 * verification, idempotency layer, finalizer dispatch, transactional
 * unlock, and unified-payment recording are all exercised end-to-end.
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

test("stripe webhook unlocks candidate boost", async ({ playwright }) => {
  const baseURL = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
  const tag = `${RUN_TAG}-stripe`;
  const candidateId = await seedCandidate(
    baseURL,
    `boost-${tag}@jumerra.test`,
    "BoostPass1234!",
    `BoostCand ${tag}`,
    playwright,
  );

  const sessionId = `cs_test_${tag}_${Date.now()}`;
  await insertPendingBoostPayment({
    candidateId,
    externalRef: sessionId,
    provider: "stripe",
    amount: 999,
    currency: "USD",
    durationDays: 30,
  });

  const payload = stripeCheckoutCompletedEvent({
    id: `evt_${tag}_${Date.now()}`,
    sessionId,
    paymentStatus: "paid",
  });
  const sig = stripeSignature(payload);

  const whCtx = await playwright.request.newContext({ baseURL });
  const res = await whCtx.post("/api/webhooks/stripe", {
    headers: {
      "stripe-signature": sig,
      "content-type": "application/json",
    },
    data: payload,
  });
  expect(res.status()).toBe(200);

  const after = await getBoostPaymentBySessionId(sessionId);
  expect(after!.status).toBe("paid");
  expect(after!.paidAt).not.toBeNull();
  expect(after!.boostExpiresAt).not.toBeNull();

  const cand = await getCandidateById(candidateId);
  expect(cand!.isBoosted).toBe(true);
  expect(cand!.boostExpiresAt).not.toBeNull();
  expect(cand!.boostExpiresAt!.getTime()).toBeGreaterThan(Date.now());

  await whCtx.dispose();
});

test("stripe webhook rejects invalid signature", async ({ playwright }) => {
  const baseURL = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
  const payload = stripeCheckoutCompletedEvent({
    id: `evt_bad_${Date.now()}`,
    sessionId: `cs_test_bad_${Date.now()}`,
  });
  const whCtx = await playwright.request.newContext({ baseURL });
  const res = await whCtx.post("/api/webhooks/stripe", {
    headers: {
      "stripe-signature": "t=0,v1=deadbeef",
      "content-type": "application/json",
    },
    data: payload,
  });
  expect(res.status()).toBe(400);
  await whCtx.dispose();
});

test("paystack webhook unlocks candidate boost (NGN rail)", async ({
  playwright,
}) => {
  const baseURL = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
  const tag = `${RUN_TAG}-paystack`;
  const candidateId = await seedCandidate(
    baseURL,
    `psk-${tag}@jumerra.test`,
    "PaystackPass1!",
    `PskCand ${tag}`,
    playwright,
  );

  // Paystack rows still use stripeSessionId column for the external
  // reference (see replit.md > Payments). Re-use that field with the
  // Paystack reference string.
  const reference = `psk_ref_${tag}_${Date.now()}`;
  await insertPendingBoostPayment({
    candidateId,
    externalRef: reference,
    provider: "paystack",
    paystackReference: reference,
    amount: 500_000, // 5,000 NGN in kobo
    currency: "NGN",
    durationDays: 30,
  });

  const payload = paystackChargeSuccessEvent({
    reference,
    amount: 500_000,
    currency: "NGN",
  });
  const sig = paystackSignature(payload);

  const whCtx = await playwright.request.newContext({ baseURL });
  const res = await whCtx.post("/api/webhooks/paystack", {
    headers: {
      "x-paystack-signature": sig,
      "content-type": "application/json",
    },
    data: payload,
  });
  expect(res.status()).toBe(200);

  const after = await getBoostPaymentBySessionId(reference);
  expect(after!.status).toBe("paid");
  expect(after!.paidAt).not.toBeNull();

  const cand = await getCandidateById(candidateId);
  expect(cand!.isBoosted).toBe(true);

  await whCtx.dispose();
});

test("paystack webhook rejects invalid signature", async ({ playwright }) => {
  const baseURL = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
  const payload = paystackChargeSuccessEvent({
    reference: `bad_${Date.now()}`,
    amount: 1,
    currency: "NGN",
  });
  const whCtx = await playwright.request.newContext({ baseURL });
  const res = await whCtx.post("/api/webhooks/paystack", {
    headers: {
      "x-paystack-signature": "0".repeat(128),
      "content-type": "application/json",
    },
    data: payload,
  });
  expect(res.status()).toBe(400);
  await whCtx.dispose();
});
