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

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
