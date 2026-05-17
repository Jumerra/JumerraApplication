import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR =
  process.env.E2E_FAILURE_OUT_DIR ??
  path.resolve(process.cwd(), ".local/post-merge-logs");
const OUT_FILE = path.join(OUT_DIR, "e2e-failures.txt");
const QUARANTINE_FILE = path.join(OUT_DIR, "e2e-quarantined.txt");
const HISTORY_FILE = path.join(OUT_DIR, "e2e-history.jsonl");

const REQUEST_ID_RE =
  /(?:x-request-id|request[-_]?id)[=:\s"]+([A-Za-z0-9_-]{8,})/i;

/**
 * A test is treated as quarantined (still runs, surfaces in the
 * post-merge summary, but does NOT fail the post-merge script) when
 * it carries an annotation of type "quarantine". Add one inside the
 * test body:
 *
 *   test("flaky journey", async () => {
 *     test.info().annotations.push({
 *       type: "quarantine",
 *       description: "TICKET-123 — flakes on Stripe webhook race",
 *     });
 *     // ...
 *   });
 *
 * Or attach it at declaration time via the per-test annotation arg.
 * The reporter looks at both the test's own annotations and the
 * annotations inherited from its parent describe blocks.
 */
const QUARANTINE_TYPE = "quarantine";

interface FailureRecord {
  journey: string;
  file: string;
  status: TestResult["status"];
  firstLine: string;
  requestId?: string;
  attempts: number;
  reason?: string;
}

/**
 * One row per test in the per-run JSONL history. Used by the weekly
 * flaky-journey summariser (`pnpm --filter @workspace/scripts run
 * flaky-report`) — keep the shape stable or bump a version field.
 */
interface HistoryTestRecord {
  journey: string;
  file: string;
  status: TestResult["status"];
  quarantined: boolean;
  reason?: string;
  attempts: number;
}

interface HistoryRunRecord {
  schema: 1;
  runId: string;
  finishedAt: string;
  durationMs: number;
  results: HistoryTestRecord[];
}

function isQuarantined(test: TestCase, result: TestResult): string | undefined {
  const all = [...test.annotations, ...result.annotations];
  const hit = all.find((a) => a.type === QUARANTINE_TYPE);
  return hit ? (hit.description ?? "(no reason given)") : undefined;
}

/**
 * Append dropped lines to a rolling monthly archive file before they
 * leave the live history. Lines are bucketed by the YYYY-MM of their
 * `finishedAt` so each archive file holds a single calendar month.
 *
 * After writing the archive entries, the archive directory itself is
 * capped at E2E_ARCHIVE_RETENTION_MONTHS (default 12) — oldest files
 * (by their YYYY-MM filename, which sorts correctly) are deleted so
 * the archive can't reintroduce the unbounded-growth problem the
 * live-file prune was added to solve.
 */
export function archiveDroppedLines(
  archiveDir: string,
  droppedLines: string[],
): void {
  if (droppedLines.length === 0) return;

  const byMonth = new Map<string, string[]>();
  for (const line of droppedLines) {
    let key = "unknown";
    try {
      const parsed = JSON.parse(line) as { finishedAt?: string };
      if (parsed && typeof parsed.finishedAt === "string") {
        const ts = Date.parse(parsed.finishedAt);
        if (Number.isFinite(ts)) {
          const d = new Date(ts);
          const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
          const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
          key = `${yyyy}-${mm}`;
        }
      }
    } catch {
      // unparseable lines are bucketed into "unknown" so they aren't lost
    }
    let bucket = byMonth.get(key);
    if (!bucket) {
      bucket = [];
      byMonth.set(key, bucket);
    }
    bucket.push(line);
  }

  fs.mkdirSync(archiveDir, { recursive: true });
  for (const [month, lines] of byMonth) {
    const target = path.join(archiveDir, `e2e-history-${month}.jsonl`);
    fs.appendFileSync(target, `${lines.join("\n")}\n`);
  }

  // Cap the number of monthly archive files. YYYY-MM sorts
  // lexicographically the same as chronologically, so the lowest names
  // are the oldest. "unknown" sorts before any real year, so it gets
  // pruned first — acceptable since unparseable lines have no date.
  const months = Number(process.env.E2E_ARCHIVE_RETENTION_MONTHS ?? "12");
  if (Number.isFinite(months) && months > 0) {
    const files = fs
      .readdirSync(archiveDir)
      .filter((n) => /^e2e-history-.+\.jsonl$/.test(n))
      .sort();
    while (files.length > months) {
      const drop = files.shift();
      if (!drop) break;
      try {
        fs.unlinkSync(path.join(archiveDir, drop));
      } catch {
        // best-effort
      }
    }
  }
}

/**
 * Drop runs older than the retention window from the JSONL history.
 * Default 90 days, overridable via E2E_HISTORY_RETENTION_DAYS. A
 * value of 0 (or non-finite) disables pruning entirely.
 *
 * Writes to a tmp file in the same directory and renames over the
 * original so a crash mid-write can't truncate the history. Lines
 * that don't parse, or that have no usable finishedAt timestamp, are
 * kept — better to keep junk than to silently drop history.
 *
 * Dropped lines are appended to a monthly archive under
 * `<dir>/archive/e2e-history-YYYY-MM.jsonl` before the live file is
 * rewritten so we keep a long-term audit trail. See
 * `archiveDroppedLines` for the archive cap.
 */
export function pruneHistory(file: string, nowMs: number): void {
  const days = Number(process.env.E2E_HISTORY_RETENTION_DAYS ?? "90");
  if (!Number.isFinite(days) || days <= 0) return;
  if (!fs.existsSync(file)) return;

  // Concurrency: pruning is a read-modify-write on the whole file, so
  // two reporters racing could each read a copy that misses the
  // other's append and then rename their stale copy over the file,
  // dropping the just-appended row. Guard with an exclusive-create
  // lock file. If we can't take the lock, another reporter is already
  // pruning — skip this run; the next one will catch up. Stale locks
  // (>5 min, e.g. from a crashed process) are forcibly cleared.
  const lock = `${file}.prune.lock`;
  const STALE_MS = 5 * 60 * 1000;
  try {
    const st = fs.statSync(lock);
    if (nowMs - st.mtimeMs > STALE_MS) fs.unlinkSync(lock);
  } catch {
    // no existing lock — normal path
  }
  let lockFd: number;
  try {
    lockFd = fs.openSync(lock, "wx");
  } catch {
    return; // another reporter holds the lock; let it handle pruning
  }

  try {
    const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
    const raw = fs.readFileSync(file, "utf8");
    const lines = raw.split("\n");
    const kept: string[] = [];
    const droppedLines: string[] = [];
    for (const line of lines) {
      if (!line) continue;
      let keep = true;
      try {
        const parsed = JSON.parse(line) as { finishedAt?: string };
        if (parsed && typeof parsed.finishedAt === "string") {
          const ts = Date.parse(parsed.finishedAt);
          if (Number.isFinite(ts) && ts < cutoff) keep = false;
        }
      } catch {
        // unparseable — keep it
      }
      if (keep) kept.push(line);
      else droppedLines.push(line);
    }
    if (droppedLines.length > 0) {
      // Archive first — if the rewrite below crashes, we'd rather have
      // duplicate rows in the archive than no record of them at all.
      // If archiving fails (disk full, permissions, …), SKIP the prune
      // entirely so we never drop data we couldn't save. The next run
      // will retry; the live file growing one more day is the lesser
      // evil compared to losing the audit trail.
      try {
        archiveDroppedLines(
          path.join(path.dirname(file), "archive"),
          droppedLines,
        );
      } catch (err) {
        process.stderr.write(
          `[post-merge-reporter] archive write failed; skipping history prune to preserve audit trail: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
        return;
      }
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, kept.length > 0 ? `${kept.join("\n")}\n` : "");
      fs.renameSync(tmp, file);
    }
  } finally {
    try {
      fs.closeSync(lockFd);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(lock);
    } catch {
      // ignore
    }
  }
}

function renderRecord(f: FailureRecord): string {
  const head = `- [${f.status}${f.attempts > 1 ? ` after ${f.attempts} attempts` : ""}] ${f.journey}`;
  const where = `  file: ${f.file}`;
  const msg = `  error: ${f.firstLine}`;
  const rid = f.requestId ? `  request-id: ${f.requestId}` : null;
  const why = f.reason ? `  quarantine: ${f.reason}` : null;
  return [head, where, msg, rid, why].filter(Boolean).join("\n");
}

export default class PostMergeReporter implements Reporter {
  private failures: FailureRecord[] = [];
  private quarantined: FailureRecord[] = [];
  private history: HistoryTestRecord[] = [];
  private startedAt = Date.now();

  onTestEnd(test: TestCase, result: TestResult): void {
    // Only record the final attempt — Playwright reports each retry
    // as its own onTestEnd. A test that passes on retry has its
    // final status set to "passed" only on the last attempt.
    if (
      (result.status === "failed" || result.status === "timedOut") &&
      result.retry < test.retries
    ) {
      return;
    }

    const journey = test
      .titlePath()
      .filter((s) => s && s !== "")
      .join(" \u203a ");
    const file = path.relative(process.cwd(), test.location.file);
    const reason = isQuarantined(test, result);
    const attempts = result.retry + 1;

    this.history.push({
      journey,
      file,
      status: result.status,
      quarantined: reason !== undefined,
      reason,
      attempts,
    });

    if (result.status !== "failed" && result.status !== "timedOut") return;

    const messages = [
      result.error?.message ?? "",
      ...result.errors.map((e) => e.message ?? ""),
    ].join("\n");
    const firstLine = (result.error?.message ?? "(no error message)")
      .split("\n")[0]
      .slice(0, 400);
    const requestId = messages.match(REQUEST_ID_RE)?.[1];

    const record: FailureRecord = {
      journey,
      file,
      status: result.status,
      firstLine,
      requestId,
      attempts,
      reason,
    };

    if (reason !== undefined) {
      this.quarantined.push(record);
    } else {
      this.failures.push(record);
    }
  }

  async onEnd(_result: FullResult): Promise<void> {
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
    } catch {
      // ignore — stdout below is the canonical surface
    }

    // Always write (or clear) both files so post-merge.sh can
    // distinguish "no failures" from "only quarantined failures"
    // without ambiguity.
    const failuresBody =
      this.failures.length > 0
        ? `${this.failures.map(renderRecord).join("\n\n")}\n`
        : "";
    const quarantineBody =
      this.quarantined.length > 0
        ? `${this.quarantined.map(renderRecord).join("\n\n")}\n`
        : "";

    try {
      if (failuresBody) fs.writeFileSync(OUT_FILE, failuresBody);
      else if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);
      if (quarantineBody) fs.writeFileSync(QUARANTINE_FILE, quarantineBody);
      else if (fs.existsSync(QUARANTINE_FILE)) fs.unlinkSync(QUARANTINE_FILE);
    } catch {
      // ignore — stdout below is the canonical surface
    }

    // Append a per-run JSONL row so the weekly summariser can compute
    // how long each journey has been quarantined and its rolling
    // pass rate. JSONL (not a single rewritten JSON) keeps appends
    // atomic-ish even when two runs race, and is trivial to truncate
    // with `tail -n`.
    //
    // Retention: the file would otherwise grow forever (one row per
    // test per run, hundreds of tests per day). After appending the
    // new run we rewrite the file dropping any run older than
    // E2E_HISTORY_RETENTION_DAYS (default 90). The flaky summariser
    // only walks back to find the current quarantine streak, so as
    // long as the window comfortably exceeds a realistic streak we
    // produce identical reports for the last 7 days.
    if (this.history.length > 0) {
      const finishedAt = Date.now();
      const run: HistoryRunRecord = {
        schema: 1,
        runId:
          process.env.E2E_RUN_ID ??
          `${new Date(finishedAt).toISOString()}-${process.pid}`,
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: finishedAt - this.startedAt,
        results: this.history,
      };
      try {
        fs.appendFileSync(HISTORY_FILE, `${JSON.stringify(run)}\n`);
      } catch {
        // ignore — best-effort persistence
      }
      try {
        pruneHistory(HISTORY_FILE, finishedAt);
      } catch {
        // ignore — pruning is best-effort, never fail the run
      }
    }

    if (this.failures.length > 0) {
      process.stdout.write(
        `\nE2E suite: ${this.failures.length} failing journey(s)\n${failuresBody}`,
      );
    }
    if (this.quarantined.length > 0) {
      process.stdout.write(
        `\nE2E suite: ${this.quarantined.length} quarantined journey(s) (not blocking)\n${quarantineBody}`,
      );
    }
  }
}
