---
name: Stripe recurring subscription table wiring
description: Every recurring-subscription table must be wired into BOTH the checkout finalizer and the lifecycle webhook handlers, not just checkout.
---

# Stripe recurring subscription lifecycle wiring

When adding a new recurring-subscription product (its own `*_subscriptions` table
with `stripe_subscription_id` / `current_period_end`), wiring only the checkout
finalizer is NOT enough. You must also extend the two shared lifecycle handlers
in `artifacts/api-server/src/lib/payment-finalizers.ts`:

- `applyStripeSubscriptionUpdate()` — handles `customer.subscription.created/updated`
  and `invoice.paid` (renewals). It looks up the row by `stripe_subscription_id`
  across every subscription table. Miss it and renewals never bump
  `current_period_end`, so the sub silently lapses to "expired" after one period.
- `markStripeSubscriptionCanceled()` — handles `customer.subscription.deleted`.
  Miss it and cancellations never reach terminal state.

**Why:** these handlers are dispatch-by-table (try institution, then employer,
then …), and the webhook only logs the result, so a missing branch fails
silently — no error, just a subscription that never renews or cancels.

**How to apply:** add a lookup+update branch for the new table in both functions,
and extend the `applyStripeSubscriptionUpdate` return-type union. Watch for
per-table column differences (e.g. `auto_apply_subscriptions` has no
`trial_ends_at`, so don't set it there).

## Related: auto_apply_log is the cap + activity source of truth

`auto_apply_log` backs both the rolling-24h daily cap and the candidate-facing
"recent auto-applications" feed. Only insert a row for a TRUE engine submission.
Logging a pre-existing/manual application (e.g. as a dedupe marker) double-counts
the cap and falsely reports manual applications as auto-applies (fabricated
stats). The applications-table dedupe check alone prevents duplicate submissions.
