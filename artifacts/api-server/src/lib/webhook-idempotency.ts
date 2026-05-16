import { db, webhookEventsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Record a webhook event as "seen" and return whether this is the
 * first time we've seen it. Caller-supplied `process` runs only on
 * first sight, inside the same logical handler frame so the response
 * to the provider reflects whatever it did.
 *
 * Idempotency is enforced by a unique index on
 * (provider, event_id). A duplicate insert throws PG `23505`, which
 * we catch and translate into `{firstSeen:false}` — the caller
 * should respond `200 {duplicate:true}` so Stripe/Paystack stops
 * retrying.
 */
export async function processWebhookOnce(args: {
  provider: "stripe" | "paystack";
  eventId: string;
  eventType: string;
  payload?: unknown;
  process: () => Promise<void>;
}): Promise<{ firstSeen: boolean }> {
  let insertedId: number;
  try {
    const inserted = await db
      .insert(webhookEventsTable)
      .values({
        provider: args.provider,
        eventId: args.eventId,
        eventType: args.eventType,
        payload: (args.payload ?? null) as unknown as object,
      })
      .returning({ id: webhookEventsTable.id });
    if (inserted.length === 0) {
      return { firstSeen: false };
    }
    insertedId = inserted[0].id;
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      // Duplicate delivery — already processed (or in flight). Tell
      // the caller it was already seen so it responds 200 quickly.
      return { firstSeen: false };
    }
    throw err;
  }

  try {
    await args.process();
    await db
      .update(webhookEventsTable)
      .set({ processedAt: new Date() })
      .where(eqId(insertedId));
    return { firstSeen: true };
  } catch (processErr) {
    const msg =
      processErr instanceof Error ? processErr.message : String(processErr);
    await db
      .update(webhookEventsTable)
      .set({ error: msg.slice(0, 4000) })
      .where(eqId(insertedId))
      .catch((dbErr) => {
        logger.error(
          { err: dbErr, insertedId },
          "failed to record webhook processing error",
        );
      });
    throw processErr;
  }
}

import { eq } from "drizzle-orm";
function eqId(id: number) {
  return eq(webhookEventsTable.id, id);
}
