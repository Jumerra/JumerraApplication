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
