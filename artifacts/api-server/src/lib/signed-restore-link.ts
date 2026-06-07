/**
 * Signed restore links for the trash-purge warning email.
 *
 * The purge-warning email lists soft-deleted rows that will be hard-
 * deleted in `leadDays`. Each item gets a one-click "Restore" link
 * that hits a session-less admin endpoint — useful when the warning
 * fires outside business hours and the on-call admin can't easily get
 * into the dashboard. The link must be:
 *
 *   - signed: derived from `SESSION_SECRET` via HMAC-SHA256 so a
 *     receiver can't tamper with `entity`, `id`, or `exp`.
 *   - time-limited: `exp` is set to the row's scheduled purge
 *     timestamp; after that, the row may already be gone so the link
 *     is rejected outright.
 *   - single-use: the token is bound to the row's `deletedAt` at the
 *     moment the email was generated. The verifier rejects the link
 *     unless the row currently has the **same** `deletedAt` value.
 *     After a successful restore `deletedAt` is set to null → the
 *     token can never authorize a restore again. If the row is later
 *     re-soft-deleted, the new `deletedAt` won't match the old token
 *     either — a fresh warning email will issue a fresh token. There
 *     is no separate "consumed tokens" table; the deletion timestamp
 *     itself is the consumption nonce.
 *
 * Token format: `<payload>.<sig>` where both segments are base64url-
 * encoded. `payload` is the JSON `{e, i, x, d}` (entity letter,
 * numeric id, expiry epoch-ms, deletedAt-at-issue epoch-ms). `sig`
 * is the HMAC-SHA256 of `payload` (the encoded segment, not the JSON
 * bytes) under SESSION_SECRET. The `d` claim is what makes the token
 * one-time-use — see above.
 *
 * Comparison uses `crypto.timingSafeEqual` over equal-length buffers
 * — mismatched lengths short-circuit to `false` BEFORE the call to
 * avoid the RangeError that would otherwise leak length info via the
 * 500 path.
 */

import crypto from "node:crypto";

export type RestoreEntity = "candidate" | "employer" | "institution" | "job";

const ENTITY_TO_CODE: Record<RestoreEntity, string> = {
  candidate: "c",
  employer: "e",
  institution: "i",
  job: "j",
};
const CODE_TO_ENTITY: Record<string, RestoreEntity> = {
  c: "candidate",
  e: "employer",
  i: "institution",
  j: "job",
};

interface TokenPayload {
  e: string;
  i: number;
  x: number;
  /**
   * The row's `deletedAt` (epoch-ms) at the moment the email was
   * generated. The verifier rejects the link unless this matches the
   * row's current `deletedAt` — that's what makes the token one-shot.
   */
  d: number;
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    // Boot validator already fatals in production when SESSION_SECRET
    // is missing; this guard is here for tests and the rare dev run
    // that imports this module before env validation has run.
    throw new Error("SESSION_SECRET env var is required for restore links");
  }
  return s;
}

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function signPayload(payload: string, secret: string): string {
  return b64urlEncode(
    crypto.createHmac("sha256", secret).update(payload).digest(),
  );
}

export interface CreateRestoreTokenArgs {
  entity: RestoreEntity;
  id: number;
  /** Expiry as epoch milliseconds. Typically the row's purge cutoff. */
  expiresAtMs: number;
  /**
   * The row's current `deletedAt` (epoch-ms) at issue time. Bound
   * into the token as a one-shot nonce: verifier requires the row's
   * current `deletedAt` to match this exactly, so once the row is
   * restored (deletedAt → null) or re-deleted (deletedAt → new value)
   * this token can never authorize a restore again.
   */
  deletedAtMs: number;
}

export function createRestoreToken(args: CreateRestoreTokenArgs): string {
  const payload: TokenPayload = {
    e: ENTITY_TO_CODE[args.entity],
    i: args.id,
    x: Math.floor(args.expiresAtMs),
    d: Math.floor(args.deletedAtMs),
  };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = signPayload(encoded, getSecret());
  return `${encoded}.${sig}`;
}

export type VerifyResult =
  | {
      ok: true;
      entity: RestoreEntity;
      id: number;
      expiresAtMs: number;
      deletedAtMs: number;
    }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyRestoreToken(
  token: string,
  nowMs: number = Date.now(),
): VerifyResult {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [encoded, sig] = token.split(".", 2);
  if (!encoded || !sig) return { ok: false, reason: "malformed" };

  let expected: string;
  try {
    expected = signPayload(encoded, getSecret());
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  // Constant-time compare; equal-length precondition enforced manually.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: TokenPayload;
  try {
    parsed = JSON.parse(b64urlDecode(encoded).toString("utf8")) as TokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const entity = CODE_TO_ENTITY[parsed.e];
  if (!entity) return { ok: false, reason: "malformed" };
  if (
    typeof parsed.i !== "number" ||
    !Number.isFinite(parsed.i) ||
    typeof parsed.x !== "number" ||
    !Number.isFinite(parsed.x) ||
    typeof parsed.d !== "number" ||
    !Number.isFinite(parsed.d)
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (parsed.x <= nowMs) return { ok: false, reason: "expired" };
  return {
    ok: true,
    entity,
    id: parsed.i,
    expiresAtMs: parsed.x,
    deletedAtMs: parsed.d,
  };
}

/**
 * Build the absolute URL an email recipient clicks. The endpoint is
 * mounted at `GET /api/admin/trash/restore` in `routes/admin.ts`.
 */
export function buildRestoreUrl(args: {
  origin: string;
  entity: RestoreEntity;
  id: number;
  expiresAtMs: number;
  deletedAtMs: number;
}): string {
  const token = createRestoreToken({
    entity: args.entity,
    id: args.id,
    expiresAtMs: args.expiresAtMs,
    deletedAtMs: args.deletedAtMs,
  });
  const origin = args.origin.replace(/\/+$/g, "");
  return `${origin}/api/admin/trash/restore?token=${encodeURIComponent(token)}`;
}
