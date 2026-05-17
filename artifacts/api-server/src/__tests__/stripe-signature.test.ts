import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import Stripe from "stripe";

/**
 * Stripe webhook signature verification — guards `/api/webhooks/stripe`.
 *
 * The route in `routes/webhooks.ts` instantiates `new Stripe(...)` with
 * a stub API key on purpose (HMAC verification is pure crypto, no
 * network) and calls `stripe.webhooks.constructEvent(body, sig,
 * secret)`. This suite exercises the same SDK entry point directly to
 * pin down the exact failure modes our route relies on:
 *
 *   - happy path: a freshly-signed payload + matching secret returns
 *     the parsed event without throwing
 *   - wrong secret throws (route → 400 "Invalid signature")
 *   - missing/garbled signature header throws (route → 400)
 *   - tampered body throws (route → 400; this is the key replay
 *     defense — an attacker that flips a single byte loses the sig)
 *
 * If Stripe ever changes their header format we want these tests to
 * fail loudly so the route handler can be updated in lockstep.
 */
function signStripe(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${payload}`;
  const v1 = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

describe("stripe webhook signature verification", () => {
  const secret = "whsec_test_secret_do_not_use_in_prod";
  const stripe = new Stripe("sk_test_stub_no_api_calls");
  const payload = JSON.stringify({
    id: "evt_test_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_abc", payment_status: "paid" } },
  });

  it("accepts a payload signed with the correct secret", () => {
    const sig = signStripe(payload, secret);
    const event = stripe.webhooks.constructEvent(payload, sig, secret);
    expect(event.id).toBe("evt_test_1");
    expect(event.type).toBe("checkout.session.completed");
  });

  it("rejects a payload signed with the wrong secret", () => {
    const sig = signStripe(payload, "whsec_attacker_secret");
    expect(() =>
      stripe.webhooks.constructEvent(payload, sig, secret),
    ).toThrow();
  });

  it("rejects a tampered payload (single byte flip)", () => {
    const sig = signStripe(payload, secret);
    // Flip the payment_status so the HMAC over the modified body no
    // longer matches the signature computed over the original.
    const tampered = payload.replace(
      '"payment_status":"paid"',
      '"payment_status":"unpaid"',
    );
    expect(() =>
      stripe.webhooks.constructEvent(tampered, sig, secret),
    ).toThrow();
  });

  it("rejects a missing signature header", () => {
    expect(() =>
      stripe.webhooks.constructEvent(payload, "", secret),
    ).toThrow();
  });

  it("rejects a malformed signature header", () => {
    expect(() =>
      stripe.webhooks.constructEvent(payload, "not-a-stripe-sig", secret),
    ).toThrow();
  });
});
