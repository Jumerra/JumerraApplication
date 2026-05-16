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

  // Rate-limit: count ALL rows (success + failed-attempt reservations)
  // for this candidate+kind in the last 24h, so failed/expensive runs
  // also consume quota.
  const since = new Date(Date.now() - DAY_MS);
  const dailyLimit = DAILY_LIMITS[args.kind];
  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiRequestCacheTable)
    .where(
      and(
        eq(aiRequestCacheTable.candidateId, args.candidateId),
        eq(aiRequestCacheTable.kind, args.kind),
        gte(aiRequestCacheTable.createdAt, since),
      ),
    );
  const used = Number(countRows[0]?.n ?? 0);
  if (used >= dailyLimit) {
    throw new AiRateLimitError(dailyLimit);
  }

  // Reserve quota BEFORE making the AI call so a failed/expensive
  // request still counts. If a pending row already exists from a prior
  // attempt for this exact key we leave it in place.
  if (!existing[0]) {
    try {
      await db
        .insert(aiRequestCacheTable)
        .values({
          candidateId: args.candidateId,
          kind: args.kind,
          keyHash,
          output: { _pending: true } as object,
        })
        .onConflictDoNothing({
          target: [
            aiRequestCacheTable.candidateId,
            aiRequestCacheTable.kind,
            aiRequestCacheTable.keyHash,
          ],
        });
    } catch {
      // Reservation is best-effort; proceed without if the DB hiccups.
    }
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
        set: { output: json as object },
      });
  } catch {
    // Caching is best-effort; never fail the request because of it.
  }

  return { output: parsed, fromCache: false };
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
