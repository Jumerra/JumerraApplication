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
