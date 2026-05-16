import { Router, type IRouter, type Request, type Response } from "express";
import Stripe from "stripe";
import { verifyPaystackSignature } from "../paystackClient";
import { processWebhookOnce } from "../lib/webhook-idempotency";
import {
  finalizeFromStripeSessionId,
  finalizeFromPaystackReference,
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
          const session = event.data.object as { id: string; payment_status?: string };
          if (session.payment_status && session.payment_status !== "paid") {
            return; // not paid yet — wait for async_payment_succeeded
          }
          const { flow, result } = await finalizeFromStripeSessionId(session.id);
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
          // Payment failed — record nothing; the /verify path will mark
          // the row failed on next inspection. Logging only.
          const session = event.data.object as { id: string };
          logger.info({ sessionId: session.id }, "stripe webhook: async payment failed");
        }
        // Other event types are intentionally ignored — subscription
        // lifecycle (invoice.paid, customer.subscription.updated/deleted)
        // is handled by the existing /verify endpoint plus a future
        // background reconciler.
      },
    });
    res.json({ received: true });
  } catch (err) {
    logger.error({ err, eventId: event.id }, "stripe webhook processing failed");
    // Return 200 so Stripe doesn't retry a deterministic failure.
    // The webhook_events row carries the error for later replay.
    res.status(200).json({ received: true, error: true });
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
    res.status(200).json({ received: true, error: true });
  }
});

export default router;
