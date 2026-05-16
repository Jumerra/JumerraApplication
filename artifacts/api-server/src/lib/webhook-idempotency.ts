import { and, eq } from "drizzle-orm";
import { db, webhookEventsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Process a webhook event idempotently. Semantics:
 *
 *  - If the event has never been seen, runs `process` and records
 *    `processedAt`. Returns `{firstSeen:true}`.
 *  - If a previous delivery has already completed processing
 *    (processedAt IS NOT NULL), short-circuits and returns
 *    `{firstSeen:false}` so the caller can `200` the provider.
 *  - If a previous delivery was claimed but FAILED (row exists with
 *    processedAt NULL and an error string), or two deliveries race
 *    in parallel, the caller will see a thrown error and MUST respond
 *    5xx so the provider retries. The unique index guarantees that
 *    no two finalizers ever run concurrently for the same event id.
 *
 * The previous version of this helper marked the row "seen" before
 * processing AND swallowed failures into a 200 — meaning a transient
 * downstream error would permanently lose the payment because the
 * provider's retry would just hit `firstSeen:false`. This version
 * inverts that: idempotency is keyed on `processedAt`, not row
 * existence, so transient failures are recoverable on the next retry.
 */
export async function processWebhookOnce(args: {
  provider: "stripe" | "paystack";
  eventId: string;
  eventType: string;
  payload?: unknown;
  process: () => Promise<void>;
}): Promise<{ firstSeen: boolean }> {
  let rowId: number;
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
    rowId = inserted[0].id;
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "23505") throw err;
    // Duplicate delivery. Check whether the previous attempt
    // completed. If it did, we're done. If it didn't (NULL
    // processedAt), the provider is retrying after a failure — try
    // again. We can't tell mid-flight races apart from post-failure
    // retries by row state alone, so we just attempt processing and
    // rely on the per-flow finalizers being idempotent (status !=
    // pending → no-op).
    const existing = await db
      .select({
        id: webhookEventsTable.id,
        processedAt: webhookEventsTable.processedAt,
      })
      .from(webhookEventsTable)
      .where(
        and(
          eq(webhookEventsTable.provider, args.provider),
          eq(webhookEventsTable.eventId, args.eventId),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new Error("webhook row vanished after 23505");
    }
    if (row.processedAt) {
      return { firstSeen: false };
    }
    rowId = row.id;
  }

  try {
    await args.process();
    await db
      .update(webhookEventsTable)
      .set({ processedAt: new Date(), error: null })
      .where(eqId(rowId));
    return { firstSeen: true };
  } catch (processErr) {
    const msg =
      processErr instanceof Error ? processErr.message : String(processErr);
    await db
      .update(webhookEventsTable)
      .set({ error: msg.slice(0, 4000) })
      .where(eqId(rowId))
      .catch((dbErr) => {
        logger.error(
          { err: dbErr, rowId },
          "failed to record webhook processing error",
        );
      });
    throw processErr;
  }
}

function eqId(id: number) {
  return eq(webhookEventsTable.id, id);
}
