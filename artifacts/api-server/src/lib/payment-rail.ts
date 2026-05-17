/**
 * Payment-rail selection. The platform is Ghana/Africa-first and Stripe
 * is intentionally disabled at the routing layer because Stripe does
 * not support Ghana-based merchants — every checkout is sent to
 * Paystack regardless of currency or any override the caller passes.
 *
 * The "stripe" branch is retained as a type for historical payment
 * rows (existing `boost_payments`, `cv_payments`, etc. with
 * `provider='stripe'` from before the Ghana switch) so reads of old
 * data keep working, but no new checkout will ever be routed through
 * it. To re-enable Stripe in the future, restore the
 * currency/override branching that lived here previously.
 *
 * `PAYSTACK_NATIVE` is kept as a hint for UIs that want to pre-select
 * the most-local currency for a buyer — it is no longer used for
 * routing.
 */

export type PaymentRail = "stripe" | "paystack";

const PAYSTACK_NATIVE = new Set(["ngn", "ghs", "zar", "kes"]);

export function isPaystackCurrency(currency: string): boolean {
  return PAYSTACK_NATIVE.has(currency.toLowerCase());
}

/**
 * Always returns "paystack". See file header for why.
 *
 * `opts.currency` and `opts.override` are accepted for backwards
 * compatibility with existing callers but are intentionally ignored.
 */
export function selectPaymentRail(_opts: {
  currency: string;
  override?: PaymentRail | null;
}): PaymentRail {
  return "paystack";
}

export function isPaystackConfigured(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

export function isStripeWebhookConfigured(): boolean {
  return !!process.env.STRIPE_WEBHOOK_SECRET;
}
