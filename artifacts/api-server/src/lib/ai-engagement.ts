import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, aiRequestCacheTable } from "@workspace/db";
import { getAnthropic, ANTHROPIC_MODEL } from "../aiClient";

export class AiRateLimitError extends Error {
  constructor(public dailyLimit: number) {
    super(`Daily AI limit reached (${dailyLimit})`);
    this.name = "AiRateLimitError";
  }
}

export class AiUnavailableError extends Error {
  constructor(message = "AI service unavailable") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type AiKind = "cover_note" | "interview_prep" | "cv_critique";

export const DAILY_LIMITS: Record<AiKind, number> = {
  cover_note: 20,
  interview_prep: 20,
  cv_critique: 10,
};

function hashKey(parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Run an AI call with per-(candidate,kind,key) caching and a rolling
 * 24h per-candidate quota. Returns the cached or freshly generated
 * JSON output and a `fromCache` flag so callers can surface it.
 *
 * `build()` must return the prompt to send to Claude. Output is parsed
 * as JSON, so the prompt MUST instruct the model to respond with raw
 * JSON only (no markdown fences).
 */
export async function aiCachedJson<T>(args: {
  candidateId: number;
  kind: AiKind;
  keyParts: unknown[];
  build: () => { system: string; user: string };
  parser: (raw: unknown) => T;
  regenerate?: boolean;
}): Promise<{ output: T; fromCache: boolean }> {
  // When the caller asks to regenerate we bust the cache by mixing a
  // per-call nonce into the key. This produces a brand-new row instead
  // of overwriting the existing one, so prior generations remain in the
  // history and quota counts every regeneration.
  const effectiveKeyParts = args.regenerate
    ? [...args.keyParts, "regen", Date.now(), Math.random()]
    : args.keyParts;
  const keyHash = hashKey(effectiveKeyParts);

  const existing = args.regenerate
    ? []
    : await db
        .select()
        .from(aiRequestCacheTable)
        .where(
          and(
            eq(aiRequestCacheTable.candidateId, args.candidateId),
            eq(aiRequestCacheTable.kind, args.kind),
            eq(aiRequestCacheTable.keyHash, keyHash),
          ),
        )
        .limit(1);
  // Skip "_pending" reservation rows from previously failed attempts —
  // they exist only to consume quota and don't have usable output.
  if (existing[0] && !isPendingRow(existing[0].output)) {
    return {
      output: args.parser(existing[0].output),
      fromCache: true,
    };
  }

  // Rate-limit: SUM attempts (NOT count rows) so repeated retries of
  // the same key after a model/parse failure each consume a quota
  // slot. Counting rows would let an attacker (or buggy client) hit
  // Anthropic indefinitely after a single failure on a stable key.
  // We anchor the rolling window on `updatedAt` (bumped on every
  // attempt) rather than `createdAt`, otherwise an old cache row that
  // gets retried today would not contribute to today's quota.
  const since = new Date(Date.now() - DAY_MS);
  const dailyLimit = DAILY_LIMITS[args.kind];
  const countRows = await db
    .select({
      n: sql<number>`coalesce(sum(${aiRequestCacheTable.attempts}), 0)::int`,
    })
    .from(aiRequestCacheTable)
    .where(
      and(
        eq(aiRequestCacheTable.candidateId, args.candidateId),
        eq(aiRequestCacheTable.kind, args.kind),
        gte(aiRequestCacheTable.updatedAt, since),
      ),
    );
  const used = Number(countRows[0]?.n ?? 0);
  if (used >= dailyLimit) {
    throw new AiRateLimitError(dailyLimit);
  }

  // Reserve quota and elect an "owner" for this attempt with a single
  // atomic upsert:
  //   - First concurrent caller wins the INSERT and gets attempts=1
  //     (it is the owner).
  //   - Subsequent racers / explicit retries take the conflict branch
  //     which atomically increments `attempts` and bumps `updated_at`,
  //     consuming a quota slot. They are NOT owners and must not call
  //     Anthropic until they've polled the in-flight result.
  // The `setWhere` guard prevents a successful row's output from being
  // clobbered or its attempts inflated unless `regenerate` is set; in
  // that case we simply re-read the row below and serve the cached
  // value.
  let weOwnAttempt = false;
  try {
    const reserved = await db
      .insert(aiRequestCacheTable)
      .values({
        candidateId: args.candidateId,
        kind: args.kind,
        keyHash,
        output: { _pending: true } as object,
        attempts: 1,
      })
      .onConflictDoUpdate({
        target: [
          aiRequestCacheTable.candidateId,
          aiRequestCacheTable.kind,
          aiRequestCacheTable.keyHash,
        ],
        set: {
          attempts: sql`${aiRequestCacheTable.attempts} + 1`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${aiRequestCacheTable.output} ? '_pending' OR ${args.regenerate ? sql`true` : sql`false`}`,
      })
      .returning({
        attempts: aiRequestCacheTable.attempts,
        output: aiRequestCacheTable.output,
      });
    const row = reserved[0];
    if (!row) {
      // Conflict matched but `setWhere` blocked the update: a
      // successful (non-pending) row already exists for this key and
      // the caller did not ask to regenerate. Re-read and return the
      // cached output rather than firing a duplicate Anthropic call.
      const [hit] = await db
        .select({ output: aiRequestCacheTable.output })
        .from(aiRequestCacheTable)
        .where(
          and(
            eq(aiRequestCacheTable.candidateId, args.candidateId),
            eq(aiRequestCacheTable.kind, args.kind),
            eq(aiRequestCacheTable.keyHash, keyHash),
          ),
        )
        .limit(1);
      if (hit && !isPendingRow(hit.output)) {
        return { output: args.parser(hit.output), fromCache: true };
      }
      // Pending row exists but our update was blocked (shouldn't
      // happen given the setWhere). Treat as race — poll then proceed.
      weOwnAttempt = true;
    } else if (row.attempts === 1) {
      // We just inserted a fresh row — we own this attempt.
      weOwnAttempt = true;
    } else {
      // Our update incremented an existing pending row's attempts:
      // someone else is mid-flight. Poll for their result and only
      // fall through to a duplicate call if polling times out.
      const polled = await pollForCompletion({
        candidateId: args.candidateId,
        kind: args.kind,
        keyHash,
      });
      if (polled) {
        return { output: args.parser(polled), fromCache: true };
      }
      // Polling timed out — assume the original owner died or is
      // stuck; take ownership and proceed.
      weOwnAttempt = true;
    }
  } catch {
    // Reservation is best-effort; if the DB hiccups, proceed as the
    // owner so the user-facing request can still complete.
    weOwnAttempt = true;
  }

  if (!weOwnAttempt) {
    // Defensive: if we ever reach here without ownership, do not call
    // Anthropic — return a transient error so the client can retry.
    throw new AiUnavailableError("AI request is in-flight; please retry");
  }

  const { system, user } = args.build();
  let raw: string;
  try {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = response.content[0];
    raw = block && block.type === "text" ? block.text : "";
  } catch (err) {
    throw new AiUnavailableError(
      err instanceof Error ? err.message : "AI service unavailable",
    );
  }

  const json = parseJsonFromModel(raw);
  const parsed = args.parser(json);

  // Replace the pending reservation (or insert) with the real output.
  // We DO NOT increment attempts here — that already happened during
  // the reservation step above.
  try {
    await db
      .insert(aiRequestCacheTable)
      .values({
        candidateId: args.candidateId,
        kind: args.kind,
        keyHash,
        output: json as object,
      })
      .onConflictDoUpdate({
        target: [
          aiRequestCacheTable.candidateId,
          aiRequestCacheTable.kind,
          aiRequestCacheTable.keyHash,
        ],
        set: { output: json as object, updatedAt: sql`now()` },
      });
  } catch {
    // Caching is best-effort; never fail the request because of it.
  }

  return { output: parsed, fromCache: false };
}

/**
 * Poll for up to ~5s waiting for an in-flight same-key request to
 * write its real output. Returns the parsed output when it appears,
 * or null on timeout (caller should fall back to making its own call).
 */
async function pollForCompletion(args: {
  candidateId: number;
  kind: AiKind;
  keyHash: string;
}): Promise<unknown | null> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const [row] = await db
      .select({ output: aiRequestCacheTable.output })
      .from(aiRequestCacheTable)
      .where(
        and(
          eq(aiRequestCacheTable.candidateId, args.candidateId),
          eq(aiRequestCacheTable.kind, args.kind),
          eq(aiRequestCacheTable.keyHash, args.keyHash),
        ),
      )
      .limit(1);
    if (row && !isPendingRow(row.output)) return row.output;
  }
  return null;
}

function isPendingRow(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { _pending?: unknown })._pending === true
  );
}

function parseJsonFromModel(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json ... ``` fences if the model added them despite
  // instructions.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last-ditch: find first '{' / '[' and last matching bracket.
    const firstBrace = candidate.search(/[{[]/);
    const lastBrace = Math.max(
      candidate.lastIndexOf("}"),
      candidate.lastIndexOf("]"),
    );
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const slice = candidate.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(slice);
      } catch {
        /* fall through */
      }
    }
    throw new AiUnavailableError("AI response was not valid JSON");
  }
}
