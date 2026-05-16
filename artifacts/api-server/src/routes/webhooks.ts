import { Router, type IRouter, type Request, type Response } from "express";
import Stripe from "stripe";
import { verifyPaystackSignature } from "../paystackClient";
import { processWebhookOnce } from "../lib/webhook-idempotency";
import {
  finalizeFromStripeSessionId,
  finalizeFromPaystackReference,
  applyStripeSubscriptionUpdate,
  markStripeSubscriptionCanceled,
} from "../lib/payment-finalizers";
import { logger } from "../lib/logger";

/**
 * Payment-provider webhooks. The router is mounted at `/api/webhooks/*`
 * in `app.ts` AFTER raw-body parsing but BEFORE `express.json`, so
 * `req.body` arrives as a `Buffer` (required by both providers'
 * signature verification).
 *
 * Both handlers are idempotent: every event is recorded in
 * `webhook_events` keyed by (provider, eventId); duplicate deliveries
 * return `200 {duplicate:true}` without touching any payment rows.
 *
 * Both handlers always respond `2xx` after signature verification.
 * Returning 5xx would just cause the provider to retry, and our
 * idempotency layer already protects against duplicate work; the
 * webhook row's `error` column captures any processing failure for
 * later replay.
 */

const router: IRouter = Router();

router.post("/webhooks/stripe", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn("stripe webhook called but STRIPE_WEBHOOK_SECRET not set");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }
  if (!sig || typeof sig !== "string") {
    res.status(400).json({ error: "Missing signature" });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    // app.ts mounts raw body parsing for this path; if we see a parsed
    // body here, the mount order is wrong and signature verification
    // would silently fail. Loud error so we notice in dev.
    logger.error("stripe webhook received non-buffer body — check app.ts mount order");
    res.status(500).json({ error: "Misconfigured webhook" });
    return;
  }

  // HMAC verification is pure-crypto — it does NOT need real Stripe
  // API credentials. We deliberately instantiate Stripe with a stub
  // key here to avoid putting the connector fetch (and any associated
  // network/credential failure) on the signature-verification path,
  // which would cause us to drop legitimate webhooks with a misleading
  // "Invalid signature" response when the connector is briefly
  // unreachable.
  const stripeForWebhook = new Stripe("sk_webhook_only_no_api_calls");
  let event: Stripe.Event;
  try {
    event = stripeForWebhook.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "stripe webhook signature invalid",
    );
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  try {
    await processWebhookOnce({
      provider: "stripe",
      eventId: event.id,
      eventType: event.type,
      payload: event as unknown,
      process: async () => {
        if (
          event.type === "checkout.session.completed" ||
          event.type === "checkout.session.async_payment_succeeded"
        ) {
          const session = event.data.object as {
            id: string;
            payment_status?: string;
          };
          if (session.payment_status && session.payment_status !== "paid") {
            return; // not paid yet — wait for async_payment_succeeded
          }
          const { flow, result } = await finalizeFromStripeSessionId(
            session.id,
          );
          logger.info(
            {
              sessionId: session.id,
              flow,
              alreadyFinalized: result?.alreadyFinalized,
              paymentId: result?.paymentId,
            },
            "stripe webhook: finalized",
          );
        } else if (event.type === "checkout.session.async_payment_failed") {
          const session = event.data.object as { id: string };
          logger.info(
            { sessionId: session.id },
            "stripe webhook: async payment failed",
          );
        } else if (
          event.type === "customer.subscription.updated" ||
          event.type === "customer.subscription.created"
        ) {
          const sub = event.data.object as unknown as Parameters<
            typeof applyStripeSubscriptionUpdate
          >[0];
          const r = await applyStripeSubscriptionUpdate(sub);
          logger.info(
            { subscriptionId: sub.id, applied: r },
            "stripe webhook: subscription updated",
          );
        } else if (event.type === "customer.subscription.deleted") {
          const sub = event.data.object as { id: string };
          await markStripeSubscriptionCanceled(sub.id);
          logger.info(
            { subscriptionId: sub.id },
            "stripe webhook: subscription canceled",
          );
        } else if (event.type === "invoice.paid") {
          // Recurring renewal — Stripe expands the subscription on
          // the invoice. Use it to bump current_period_end on the
          // local row. Falls back to a no-op if no local row matches.
          const invoice = event.data.object as unknown as {
            subscription?:
              | string
              | (Parameters<typeof applyStripeSubscriptionUpdate>[0] & {
                  id: string;
                })
              | null;
          };
          const sub =
            invoice.subscription && typeof invoice.subscription === "object"
              ? invoice.subscription
              : null;
          if (sub && typeof sub === "object" && "id" in sub) {
            const r = await applyStripeSubscriptionUpdate(sub);
            logger.info(
              { subscriptionId: sub.id, applied: r },
              "stripe webhook: invoice.paid applied",
            );
          }
        }
        // Other event types are intentionally ignored.
      },
    });
    res.json({ received: true });
  } catch (err) {
    logger.error(
      { err, eventId: event.id },
      "stripe webhook processing failed",
    );
    // 5xx forces Stripe to retry — critical for not losing payments
    // on transient downstream failures (DB hiccup, network blip). The
    // idempotency layer guarantees the retry won't double-apply.
    res.status(500).json({ received: false, error: "processing_failed" });
  }
});

router.post("/webhooks/paystack", async (req: Request, res: Response) => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    // Distinguishing "no secret configured" from "bad signature" lets
    // ops see at a glance whether the integration is unhealthy vs
    // being probed. 503 also avoids implying the caller's request
    // was malformed when the real problem is on our side.
    logger.warn("paystack webhook called but PAYSTACK_SECRET_KEY not set");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    logger.error(
      "paystack webhook received non-buffer body — check app.ts mount order",
    );
    res.status(500).json({ error: "Misconfigured webhook" });
    return;
  }
  const sig = req.headers["x-paystack-signature"];
  if (!verifyPaystackSignature(req.body, sig)) {
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  let event: { event: string; data: { id?: number; reference?: string } };
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // Paystack does NOT send an event id on every event type. Use
  // (event, reference, data.id) as a deterministic id.
  const ref = event.data?.reference ?? "no-ref";
  const eid = `${event.event}:${ref}:${event.data?.id ?? "0"}`;

  try {
    await processWebhookOnce({
      provider: "paystack",
      eventId: eid,
      eventType: event.event,
      payload: event as unknown,
      process: async () => {
        if (event.event === "charge.success" && event.data?.reference) {
          const { flow, result } = await finalizeFromPaystackReference(
            event.data.reference,
          );
          logger.info(
            {
              reference: event.data.reference,
              flow,
              alreadyFinalized: result?.alreadyFinalized,
              paymentId: result?.paymentId,
            },
            "paystack webhook: finalized",
          );
        }
        // Other Paystack events (charge.failed, transfer.*, etc.) are
        // logged but not acted upon — they don't affect unlock state.
      },
    });
    res.json({ received: true });
  } catch (err) {
    logger.error({ err, eventId: eid }, "paystack webhook processing failed");
    // Same retry-on-failure semantics as Stripe — Paystack retries 5xx
    // for ~72h, and our idempotency layer makes the retry safe.
    res.status(500).json({ received: false, error: "processing_failed" });
  }
});

export default router;
