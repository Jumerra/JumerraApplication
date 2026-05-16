/**
 * Payment-rail selection. Africa-first: native African currencies are
 * routed through Paystack (which has local card acquiring, instant
 * settlement, USSD/bank-transfer fallbacks, and ~3-4% fees vs Stripe's
 * 4-7% for cross-border African cards). Everything else falls through
 * to Stripe so global USD/EUR/GBP customers get the rail they expect.
 *
 * `PAYSTACK_NATIVE` is intentionally narrow — only the currencies
 * Paystack actually settles in. Adding a currency here without Paystack
 * supporting it would cause silent checkout failures.
 */

export type PaymentRail = "stripe" | "paystack";

const PAYSTACK_NATIVE = new Set(["ngn", "ghs", "zar", "kes"]);

export function isPaystackCurrency(currency: string): boolean {
  return PAYSTACK_NATIVE.has(currency.toLowerCase());
}

/**
 * Decide which rail handles a checkout for a given currency.
 *
 * `override`: explicit caller choice (e.g. an admin force-route, or a
 *   customer-facing rail picker). Respected verbatim when valid.
 *
 * If Paystack is not configured at all (no `PAYSTACK_SECRET_KEY`),
 * everything falls back to Stripe so the platform never serves a
 * broken checkout button just because a secret is missing.
 */
export function selectPaymentRail(opts: {
  currency: string;
  override?: PaymentRail | null;
}): PaymentRail {
  if (opts.override === "stripe" || opts.override === "paystack") {
    if (opts.override === "paystack" && !isPaystackConfigured()) {
      return "stripe";
    }
    return opts.override;
  }
  if (isPaystackCurrency(opts.currency) && isPaystackConfigured()) {
    return "paystack";
  }
  return "stripe";
}

export function isPaystackConfigured(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

export function isStripeWebhookConfigured(): boolean {
  return !!process.env.STRIPE_WEBHOOK_SECRET;
}
