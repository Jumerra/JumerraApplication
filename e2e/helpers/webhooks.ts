import crypto from "node:crypto";
import { STRIPE_WEBHOOK_SECRET, PAYSTACK_SECRET_KEY } from "./env";

/** Build a Stripe webhook signature header for the given raw payload.
 *  Mirrors `Stripe.webhooks.constructEvent` verification logic — HMAC
 *  SHA256 of `timestamp + "." + payload`, keyed by the webhook secret. */
export function stripeSignature(payload: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

/** Build a Paystack signature header — HMAC SHA512 of the raw body
 *  keyed by the Paystack secret (Paystack reuses the API secret for
 *  webhook signing). */
export function paystackSignature(payload: string): string {
  return crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(payload, "utf8")
    .digest("hex");
}

export function stripeCheckoutCompletedEvent(args: {
  id: string;
  sessionId: string;
  paymentStatus?: "paid" | "unpaid";
}): string {
  return JSON.stringify({
    id: args.id,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: args.sessionId,
        object: "checkout.session",
        payment_status: args.paymentStatus ?? "paid",
      },
    },
  });
}

export function paystackChargeSuccessEvent(args: {
  reference: string;
  amount: number;
  currency: string;
}): string {
  return JSON.stringify({
    event: "charge.success",
    data: {
      id: Math.floor(Math.random() * 1_000_000_000),
      reference: args.reference,
      amount: args.amount,
      currency: args.currency,
      status: "success",
    },
  });
}
