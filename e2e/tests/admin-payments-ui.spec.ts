import { test, expect, type BrowserContext } from "@playwright/test";
import { RUN_TAG } from "../helpers/env";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../helpers/constants";
import { login, ok } from "../helpers/api";
import {
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
 * Journey 7 (UI): Admin payments console — filters + per-row re-finalize.
 *
 * Seeds one Stripe USD and one Paystack NGN boost row by delivering
 * each provider's signed webhook (same approach as `admin-payments.spec.ts`,
 * which covers the API surface). Then drives the actual /dashboard/admin/payments
 * page in a real browser to prove that:
 *   - both rows render in the table,
 *   - filtering by provider=paystack hides the Stripe row,
 *   - typing currency=ngn hides the USD row,
 *   - the per-row Re-finalize button surfaces alreadyFinalized=true.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? "http://127.0.0.1:8091";
const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";

async function seedCandidate(
  email: string,
  password: string,
  fullName: string,
  playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"],
): Promise<number> {
  const ctx = await playwright.request.newContext({ baseURL: API_URL });
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

async function loginAdminInBrowser(
  context: BrowserContext,
  playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"],
): Promise<void> {
  // Log in via a standalone APIRequestContext (which reliably persists
  // session cookies across calls in playwright) and then mirror those
  // cookies into the browser context so the page sees the session on
  // navigation. Doing the login directly off `context.request` was
  // racy under our cookie config (Set-Cookie sometimes didn't make it
  // back into the page's jar).
  const api = await playwright.request.newContext({ baseURL: WEB_URL });
  const res = await api.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`admin login failed: ${res.status()} ${await res.text()}`);
  }
  const state = await api.storageState();
  await api.dispose();
  // Server sets `SameSite=None` (required in prod for the cross-site Expo
  // preview), which modern browsers refuse to honor without `Secure=true`.
  // The e2e dev rig runs over plain http://127.0.0.1, so we override the
  // cookie attributes to `Lax` + non-secure when mirroring them into the
  // browser context — same session id, just relaxed transport flags so
  // the browser actually stores and sends it.
  const cookies = state.cookies.map((c) => ({
    ...c,
    secure: false,
    sameSite: "Lax" as const,
  }));
  await context.addCookies(cookies);
}

test("admin payments console UI: rows render, filters narrow, re-finalize is idempotent", async ({
  browser,
  playwright,
}) => {
  const tag = `${RUN_TAG}-adminpayui`;

  // ── Seed: one Stripe USD boost + one Paystack NGN boost. ──
  const stripeCandidateId = await seedCandidate(
    `adminpayui-s-${tag}@jumerra.test`,
    "AdminPayUi1!aA",
    `Stripe UI Cand ${tag}`,
    playwright,
  );
  const paystackCandidateId = await seedCandidate(
    `adminpayui-p-${tag}@jumerra.test`,
    "AdminPayUi1!aA",
    `Paystack UI Cand ${tag}`,
    playwright,
  );

  const stripeSessionId = `cs_test_adminpayui_${tag}_${Date.now()}`;
  await insertPendingBoostPayment({
    candidateId: stripeCandidateId,
    externalRef: stripeSessionId,
    provider: "stripe",
    amount: 999,
    currency: "USD",
    durationDays: 30,
  });
  const paystackReference = `psk_ref_adminpayui_${tag}_${Date.now()}`;
  await insertPendingBoostPayment({
    candidateId: paystackCandidateId,
    externalRef: paystackReference,
    provider: "paystack",
    paystackReference,
    amount: 500_000,
    currency: "NGN",
    durationDays: 30,
  });

  // Deliver both webhooks to populate the unified payments ledger.
  const whCtx = await playwright.request.newContext({ baseURL: API_URL });
  const stripePayload = stripeCheckoutCompletedEvent({
    id: `evt_adminpayui_s_${tag}_${Date.now()}`,
    sessionId: stripeSessionId,
    paymentStatus: "paid",
  });
  expect(
    (
      await whCtx.post("/api/webhooks/stripe", {
        headers: {
          "stripe-signature": stripeSignature(stripePayload),
          "content-type": "application/json",
        },
        data: stripePayload,
      })
    ).status(),
  ).toBe(200);
  const paystackPayload = paystackChargeSuccessEvent({
    reference: paystackReference,
    amount: 500_000,
    currency: "NGN",
  });
  expect(
    (
      await whCtx.post("/api/webhooks/paystack", {
        headers: {
          "x-paystack-signature": paystackSignature(paystackPayload),
          "content-type": "application/json",
        },
        data: paystackPayload,
      })
    ).status(),
  ).toBe(200);
  await whCtx.dispose();

  const stripeLedger = await getPaymentLedgerRow("stripe", stripeSessionId);
  const paystackLedger = await getPaymentLedgerRow("paystack", paystackReference);
  expect(stripeLedger).not.toBeNull();
  expect(paystackLedger).not.toBeNull();

  // ── Drive the UI as admin. ──
  const context = await browser.newContext({ baseURL: WEB_URL });
  await loginAdminInBrowser(context, playwright);
  const page = await context.newPage();

  await page.goto("/dashboard/admin/payments");

  // The two seeded rows render. Assertions target the seeded rows by
  // their specific data-testid (`row-payment-<id>`) so unrelated rows
  // from sibling tests in the same suite run can't false-positive or
  // false-negative the checks.
  const stripeRow = page.getByTestId(`row-payment-${stripeLedger!.id}`);
  const paystackRow = page.getByTestId(`row-payment-${paystackLedger!.id}`);
  await expect(stripeRow).toBeVisible();
  await expect(paystackRow).toBeVisible();
  await expect(stripeRow).toContainText(stripeSessionId);
  await expect(paystackRow).toContainText(paystackReference);

  // Filter provider=paystack → Stripe row disappears, Paystack remains.
  await page.getByTestId("select-provider").click();
  await page.getByRole("option", { name: "Paystack" }).click();
  await expect(paystackRow).toBeVisible();
  await expect(stripeRow).toHaveCount(0);

  // Reset provider, then narrow by currency=ngn → only Paystack NGN remains.
  await page.getByTestId("button-reset-filters").click();
  await expect(stripeRow).toBeVisible();
  await expect(paystackRow).toBeVisible();

  await page.getByTestId("input-currency").fill("ngn");
  await expect(paystackRow).toBeVisible();
  await expect(stripeRow).toHaveCount(0);

  // Reset, then click the per-row Re-finalize button on the Stripe row.
  // The outcome card surfaces alreadyFinalized=true (the underlying
  // boost row + ledger row are both already `paid` from the webhook).
  await page.getByTestId("button-reset-filters").click();
  await expect(stripeRow).toBeVisible();

  await stripeRow.getByTestId(`button-refinalize-${stripeLedger!.id}`).click();

  const outcome = page.getByTestId("card-last-outcome");
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText(`payment #${stripeLedger!.id}`);
  await expect(outcome).toContainText('"provider":"stripe"');
  await expect(outcome).toContainText('"flow":"boost"');
  await expect(outcome).toContainText('"alreadyFinalized":true');
  await expect(outcome).toContainText('"reconciled":true');

  await context.close();
});
