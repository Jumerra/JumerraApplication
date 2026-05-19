/**
 * Shared loader + writer for the regression acknowledgement file.
 *
 * The file is a small JSON document at `.local/regression-acks.json` (path
 * overridable per-call) that lets the team mute already-triaged
 * regressions so `regression-report` / `regression-notify` stop pinging
 * about them every merge — without pretending they're fixed.
 *
 * Shape:
 *   {
 *     "acks": [
 *       {
 *         "file": "e2e/auth.spec.ts",
 *         "journey": "candidate can sign in",
 *         "until": "2026-06-01",         // optional ISO date (YYYY-MM-DD)
 *         "reason": "tracked in JUM-123" // optional free text
 *       }
 *     ]
 *   }
 *
 * Entries with an `until` date in the past are treated as expired and are
 * silently filtered out at read time so nothing stays muted forever. The
 * file on disk is left alone (writers may rewrite it explicitly), so a
 * dry read never mutates state.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface RegressionAck {
  file: string;
  journey: string;
  until?: string;
  reason?: string;
  /**
   * Optional contact for the person who muted this journey. Either an
   * email address or a Slack handle (e.g. `@jane` / `U012ABC`). Used by
   * `regression-notify --expiring-digest` to ping the muter directly
   * instead of relying on the broadcast channel.
   */
  author?: string;
}

export interface RegressionAcksFile {
  acks: RegressionAck[];
}

export function defaultAcksPath(): string {
  return path.resolve(process.cwd(), ".local/regression-acks.json");
}

export function ackKey(file: string, journey: string): string {
  return `${file}\u0000${journey}`;
}

function todayUtcIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isExpired(ack: RegressionAck, today: string = todayUtcIsoDate()): boolean {
  if (!ack.until) return false;
  // Compare lexicographically — both sides are YYYY-MM-DD.
  return ack.until < today;
}

export interface ExpiringAck {
  ack: RegressionAck;
  /** Whole days from `today` (inclusive) until `until` (inclusive). 0 = expires today. */
  remainingDays: number;
}

/**
 * Return active acks whose `until` date falls inside `[today, today+windowDays]`.
 * Acks without an `until` (never-expire) are skipped — they can't surprise
 * anyone by re-alerting. Already-expired acks are also skipped (they're
 * filtered out by `loadActiveAcks` upstream anyway).
 *
 * Result is sorted soonest-first so renderers don't need to re-sort.
 */
export function findExpiringAcks(
  file: string,
  windowDays: number,
  today: string = todayUtcIsoDate(),
): ExpiringAck[] {
  if (!Number.isFinite(windowDays) || windowDays < 0) return [];
  const { acks } = readAcksRaw(file);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(todayMs)) return [];
  const out: ExpiringAck[] = [];
  for (const a of acks) {
    if (!a.until) continue;
    if (isExpired(a, today)) continue;
    if (!isValidIsoDate(a.until)) continue;
    const untilMs = Date.parse(`${a.until}T00:00:00Z`);
    const remainingDays = Math.round((untilMs - todayMs) / 86_400_000);
    if (remainingDays > windowDays) continue;
    out.push({ ack: a, remainingDays });
  }
  out.sort((a, b) => a.remainingDays - b.remainingDays);
  return out;
}

export function readAcksRaw(file: string): RegressionAcksFile {
  if (!fs.existsSync(file)) return { acks: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { acks: [] };
  }
  if (!parsed || typeof parsed !== "object") return { acks: [] };
  const acks = (parsed as { acks?: unknown }).acks;
  if (!Array.isArray(acks)) return { acks: [] };
  const valid: RegressionAck[] = [];
  for (const entry of acks) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.file !== "string" || typeof e.journey !== "string") continue;
    const a: RegressionAck = { file: e.file, journey: e.journey };
    if (typeof e.until === "string") a.until = e.until;
    if (typeof e.reason === "string") a.reason = e.reason;
    if (typeof e.author === "string" && e.author.trim()) a.author = e.author.trim();
    valid.push(a);
  }
  return { acks: valid };
}

/**
 * Returns the active (non-expired) acks as a Map keyed by `file\0journey`.
 * Expired entries are dropped from the result but NOT removed from disk.
 */
export function loadActiveAcks(file: string): Map<string, RegressionAck> {
  const { acks } = readAcksRaw(file);
  const today = todayUtcIsoDate();
  const map = new Map<string, RegressionAck>();
  for (const a of acks) {
    if (isExpired(a, today)) continue;
    map.set(ackKey(a.file, a.journey), a);
  }
  return map;
}

export function writeAcks(file: string, data: RegressionAcksFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Classify an ack `author` string into a notification channel.
 *
 * - `email` — looks like an RFC-5322-ish address; the digest sends a
 *   direct Resend email to it regardless of REGRESSION_ALERT_EMAIL.
 * - `slack` — starts with `@`, or matches a Slack member id
 *   (`U`/`W` prefix), or is wrapped in `<@...>`. Webhooks can't DM, so
 *   we post to the broadcast webhook with an `<@id>`/`@handle` mention
 *   that pings the muter directly.
 * - `unknown` — falls through to the broadcast channel.
 */
export type AuthorKind = "email" | "slack" | "unknown";

export function classifyAuthor(author: string | undefined): AuthorKind {
  if (!author) return "unknown";
  const s = author.trim();
  if (!s) return "unknown";
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s)) return "email";
  if (s.startsWith("@")) return "slack";
  if (/^<@[UW][A-Z0-9]{2,}>$/.test(s)) return "slack";
  if (/^[UW][A-Z0-9]{6,}$/.test(s)) return "slack";
  return "unknown";
}

export function slackMentionFor(author: string): string {
  const s = author.trim();
  if (s.startsWith("<@") && s.endsWith(">")) return s;
  if (/^[UW][A-Z0-9]{6,}$/.test(s)) return `<@${s}>`;
  return s.startsWith("@") ? s : `@${s}`;
}

export interface AuthorBuckets<E extends { ack: { author?: string } }> {
  emails: Map<string, E[]>;
  slack: Map<string, E[]>;
  unattributed: E[];
}

export function bucketByAuthor<E extends { ack: { author?: string } }>(
  entries: E[],
): AuthorBuckets<E> {
  const emails = new Map<string, E[]>();
  const slack = new Map<string, E[]>();
  const unattributed: E[] = [];
  for (const e of entries) {
    const kind = classifyAuthor(e.ack.author);
    if (kind === "email" && e.ack.author) {
      const key = e.ack.author.trim();
      const arr = emails.get(key) ?? [];
      arr.push(e);
      emails.set(key, arr);
    } else if (kind === "slack" && e.ack.author) {
      const key = e.ack.author.trim();
      const arr = slack.get(key) ?? [];
      arr.push(e);
      slack.set(key, arr);
    } else {
      unattributed.push(e);
    }
  }
  return { emails, slack, unattributed };
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Add `days` whole days to a YYYY-MM-DD UTC date and return the result
 * in YYYY-MM-DD. Negative values are allowed.
 */
export function addDaysIso(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`invalid ISO date: ${isoDate}`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Signed one-click action tokens
// ---------------------------------------------------------------------------
//
// The expiring-ack reminder (email + Slack) embeds three buttons per ack —
// "Extend 7 days", "Extend 30 days", "Close mute" — that point at a
// receiver URL configured with `REGRESSION_ACK_ACTION_URL`. The receiver
// hands the token off to `regression-ack --apply-token TOKEN` which calls
// `applySignedAckAction`.
//
// Token shape (compact):  <payloadB64url>.<sigB64url>
// Payload (JSON):
//   { a: "extend7"|"extend30"|"close",
//     f: file,
//     j: journey,
//     u: currentUntilSnapshotOrEmpty,   // for replay protection
//     e: expEpochSeconds,
//     n: nonce }                         // pure entropy
//
// Replay protection is layered:
//   1. The HMAC is keyed on `REGRESSION_ACK_SIGNING_SECRET`, which never
//      leaves the operator's environment. Without it, an attacker cannot
//      forge a token or substitute the action.
//   2. The token carries an `exp` (default 14 days) so a leaked link
//      stops working even if the secret leaks.
//   3. The token snapshots the ack's `until` at sign time. Once the
//      action has been applied the `until` changes, so the same token
//      can't extend twice. (Close-mute is naturally idempotent — a
//      second click finds no ack and reports success-with-noop.)

export type AckActionKind = "extend7" | "extend30" | "close";

export interface AckActionPayload {
  action: AckActionKind;
  file: string;
  journey: string;
  /** ISO `until` at sign time, or empty string for never-expire acks. */
  untilSnapshot: string;
  /** Unix epoch seconds. */
  expiresAt: number;
  /** Random 12-byte hex nonce. */
  nonce: string;
}

const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmacSign(secret: string, message: string): Buffer {
  return createHmac("sha256", secret).update(message).digest();
}

function constantTimeEq(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface SignAckActionInput {
  action: AckActionKind;
  file: string;
  journey: string;
  untilSnapshot: string;
  secret: string;
  /** Defaults to 14 days. Caller may shorten. */
  ttlSeconds?: number;
  /** Override for tests. */
  now?: number;
  /** Override for tests. */
  nonce?: string;
}

export function signAckActionToken(input: SignAckActionInput): string {
  if (!input.secret) throw new Error("signAckActionToken: empty secret");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const payload = {
    a: input.action,
    f: input.file,
    j: input.journey,
    u: input.untilSnapshot,
    e: now + ttl,
    n: input.nonce ?? randomBytes(12).toString("hex"),
  };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64urlEncode(hmacSign(input.secret, body));
  return `${body}.${sig}`;
}

export type VerifyAckActionResult =
  | { ok: true; payload: AckActionPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifyAckActionToken(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): VerifyAckActionResult {
  if (!token || !secret) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const sigRaw = token.slice(dot + 1);
  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = hmacSign(secret, body);
    provided = b64urlDecode(sigRaw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!constantTimeEq(expected, provided)) return { ok: false, reason: "bad-signature" };
  let raw: unknown;
  try {
    raw = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!raw || typeof raw !== "object") return { ok: false, reason: "malformed" };
  const r = raw as Record<string, unknown>;
  if (
    (r.a !== "extend7" && r.a !== "extend30" && r.a !== "close") ||
    typeof r.f !== "string" ||
    typeof r.j !== "string" ||
    typeof r.u !== "string" ||
    typeof r.e !== "number" ||
    typeof r.n !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (r.e < now) return { ok: false, reason: "expired" };
  return {
    ok: true,
    payload: {
      action: r.a,
      file: r.f,
      journey: r.j,
      untilSnapshot: r.u,
      expiresAt: r.e,
      nonce: r.n,
    },
  };
}

export interface BuildActionUrlsInput {
  baseUrl: string;
  secret: string;
  file: string;
  journey: string;
  untilSnapshot: string;
  ttlSeconds?: number;
  now?: number;
}

export interface AckActionUrls {
  extend7: string;
  extend30: string;
  close: string;
}

export function buildAckActionUrls(input: BuildActionUrlsInput): AckActionUrls {
  const mk = (action: AckActionKind): string => {
    const token = signAckActionToken({
      action,
      file: input.file,
      journey: input.journey,
      untilSnapshot: input.untilSnapshot,
      secret: input.secret,
      ttlSeconds: input.ttlSeconds,
      now: input.now,
    });
    const sep = input.baseUrl.includes("?") ? "&" : "?";
    return `${input.baseUrl}${sep}t=${encodeURIComponent(token)}`;
  };
  return { extend7: mk("extend7"), extend30: mk("extend30"), close: mk("close") };
}

export type ApplyResultCode =
  | "applied-extend"
  | "applied-close"
  | "noop-already-closed"
  | "stale-snapshot"
  | "ack-missing";

export interface ApplyAckActionResult {
  code: ApplyResultCode;
  message: string;
  /** New `until` date when an extension was applied. */
  newUntil?: string;
}

/**
 * Apply a verified ack action against the on-disk acks file. Idempotent:
 * - extend7/extend30 are rejected if the snapshot disagrees with the
 *   current `until` (token has already been spent or the ack moved).
 * - close removes the ack if present, otherwise reports a friendly noop.
 *
 * `extend` from a never-expire ack (`untilSnapshot === ""`) is allowed
 * because the muter explicitly chose to add an expiry.
 */
export function applySignedAckAction(
  acksPath: string,
  payload: AckActionPayload,
  today: string = todayUtcIsoDate(),
): ApplyAckActionResult {
  const existing = readAcksRaw(acksPath);
  const idx = existing.acks.findIndex(
    (a) => a.file === payload.file && a.journey === payload.journey,
  );
  if (payload.action === "close") {
    if (idx === -1) {
      // True idempotent noop: the ack we were asked to close is already
      // gone. (If a new ack with the same file+journey has since been
      // created, the snapshot check below would have caught it — but
      // we can only run that check when an ack exists. The empty-state
      // path is unambiguous: nothing to close, nothing to leak.)
      return {
        code: "noop-already-closed",
        message: `Mute for "${payload.journey}" (${payload.file}) was already closed.`,
      };
    }
    // Snapshot guard for close too: if the ack has been re-created
    // (or extended) since this token was minted, the muter's intent
    // ("close the mute I knew about") no longer maps cleanly onto the
    // current state — reject as stale rather than blast away an
    // unrelated mute.
    const currentUntil = existing.acks[idx].until ?? "";
    if (currentUntil !== payload.untilSnapshot) {
      return {
        code: "stale-snapshot",
        message:
          `This link has already been used (or the mute was changed). ` +
          `Current expiry: ${existing.acks[idx].until ?? "no expiry"}.`,
      };
    }
    existing.acks.splice(idx, 1);
    writeAcks(acksPath, existing);
    return {
      code: "applied-close",
      message: `Closed mute for "${payload.journey}" (${payload.file}).`,
    };
  }
  if (idx === -1) {
    return {
      code: "ack-missing",
      message: `No active mute found for "${payload.journey}" (${payload.file}) — nothing to extend.`,
    };
  }
  const current = existing.acks[idx];
  const currentUntil = current.until ?? "";
  if (currentUntil !== payload.untilSnapshot) {
    return {
      code: "stale-snapshot",
      message:
        `This link has already been used (or the mute was changed). ` +
        `Current expiry: ${current.until ?? "no expiry"}.`,
    };
  }
  const days = payload.action === "extend7" ? 7 : 30;
  // Extend from max(currentUntil, today) so clicking "Extend 7 days" on
  // an ack that still has 20 days left never *shortens* the mute. For a
  // never-expire ack (snapshot was ""), there's no current floor — base
  // off today.
  const base = currentUntil && currentUntil > today ? currentUntil : today;
  const newUntil = addDaysIso(base, days);
  current.until = newUntil;
  existing.acks[idx] = current;
  writeAcks(acksPath, existing);
  return {
    code: "applied-extend",
    message: `Extended mute for "${payload.journey}" (${payload.file}) by ${days} days — new expiry ${newUntil}.`,
    newUntil,
  };
}
