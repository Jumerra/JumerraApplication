import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Focused integration test for `regression-notify`.
 *
 * The earlier round of this task had a cwd bug where regression-notify
 * spawned regression-report with `cwd: scripts/`, so the spawned process
 * resolved `defaultHistoryPath()` to `scripts/.local/post-merge-logs/...`
 * instead of the repo-root path post-merge.sh writes to — meaning the
 * notifier silently saw an empty history and never alerted.
 *
 * This test guards against that regression by:
 *  1. building a tmp JSONL history that *does* contain a real regression
 *     (long pass streak followed by consecutive failures), then
 *  2. invoking regression-notify with `--history <tmp>` from a CWD that
 *     is NOT the repo root, and
 *  3. asserting the script reports the regression count on stdout.
 *
 * No env channels are configured, so the script reaches the
 * "dispatching notifications" branch and then logs that no channels
 * are configured — which is exactly what we want to verify: detection
 * works end-to-end, independent of Slack/Resend credentials.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const notifyScript = path.resolve(here, "..", "regression-notify.ts");
const scriptsDir = path.resolve(here, "..", "..");
const tsxBin = path.join(scriptsDir, "node_modules", ".bin", "tsx");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-notify-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface TestRecord {
  journey: string;
  file: string;
  status: "passed" | "failed";
  quarantined: boolean;
  attempts: number;
  reason?: string;
}

function makeRun(runId: string, finishedAt: string, results: TestRecord[]) {
  return {
    schema: 1,
    runId,
    finishedAt,
    durationMs: 1000,
    results,
  };
}

function writeHistory(file: string, lines: object[]) {
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("regression-notify", () => {
  it("detects a regression using the --history path forwarded by post-merge.sh", () => {
    const historyFile = path.join(tmpDir, "e2e-history.jsonl");

    // 12 passing runs + 2 failing runs = streak 12 / failTail 2.
    // Defaults are streak>=10, fails>=2, so this is a regression.
    const journey = "candidate can sign in";
    const file = "e2e/auth.spec.ts";
    const passing: TestRecord = {
      journey,
      file,
      status: "passed",
      quarantined: false,
      attempts: 1,
    };
    const failing: TestRecord = {
      journey,
      file,
      status: "failed",
      quarantined: false,
      attempts: 1,
      reason: "AuthGate bounced to /sign-in",
    };
    const lines: object[] = [];
    for (let i = 0; i < 12; i++) {
      const ts = `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`;
      lines.push(makeRun(`run-pass-${i}`, ts, [passing]));
    }
    lines.push(makeRun("run-fail-1", "2026-05-15T12:00:00.000Z", [failing]));
    lines.push(makeRun("run-fail-2", "2026-05-16T12:00:00.000Z", [failing]));
    writeHistory(historyFile, lines);

    // Spawn from a CWD that ISN'T the repo root, mirroring the bug class
    // we're guarding against. Strip channel env vars so the notifier
    // doesn't try to POST anywhere; we're only asserting detection.
    const env = { ...process.env };
    delete env.SLACK_REGRESSION_WEBHOOK_URL;
    delete env.REGRESSION_ALERT_EMAIL;
    const proc = spawnSync(
      tsxBin,
      [notifyScript, "--history", historyFile, "--no-archive"],
      { encoding: "utf8", cwd: tmpDir, env },
    );

    expect(proc.status, `stderr: ${proc.stderr}`).toBe(0);
    expect(proc.stdout).toMatch(/1 regression detected/);
    // Without channels we expect the no-channels branch to print —
    // proves we reached dispatch, not the "nothing to send" early exit.
    expect(proc.stdout).toMatch(/no notification channels configured/);
  }, 60_000);

  it("post-merge orchestration: a per-run JSONL appended to the canonical file triggers detection", () => {
    // This guards the post-merge.sh wiring fix: the Playwright reporter
    // writes its row to a per-run subfolder that the post-merge pruner
    // eventually deletes, so post-merge.sh now appends that per-run row
    // onto a canonical repo-root JSONL BEFORE invoking the regression
    // tools. We simulate that exact handoff here.
    const canonical = path.join(tmpDir, "e2e-history.jsonl");
    const journey = "candidate can sign in";
    const file = "e2e/auth.spec.ts";
    const passing: TestRecord = {
      journey,
      file,
      status: "passed",
      quarantined: false,
      attempts: 1,
    };
    const failing: TestRecord = {
      journey,
      file,
      status: "failed",
      quarantined: false,
      attempts: 1,
      reason: "AuthGate bounced",
    };

    // Seed the canonical file with a long clean streak (12 prior merges)
    // and one earlier failing merge — emulates the historical archive.
    const seedLines: object[] = [];
    for (let i = 0; i < 12; i++) {
      const ts = `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`;
      seedLines.push(makeRun(`run-pass-${i}`, ts, [passing]));
    }
    seedLines.push(makeRun("run-fail-1", "2026-05-15T12:00:00.000Z", [failing]));
    writeHistory(canonical, seedLines);

    // Now simulate today's per-run JSONL — written by the reporter into
    // the timestamped subfolder, then appended onto canonical by
    // post-merge.sh's `cat ... >> $CANONICAL_HISTORY` step. WITHOUT
    // this append the failing tail would only be length 1 and the
    // notifier would NOT fire — proving the wiring is load-bearing.
    const perRunDir = path.join(tmpDir, "per-run");
    fs.mkdirSync(perRunDir);
    const perRunFile = path.join(perRunDir, "e2e-history.jsonl");
    writeHistory(perRunFile, [
      makeRun("run-fail-2", "2026-05-16T12:00:00.000Z", [failing]),
    ]);
    fs.appendFileSync(canonical, fs.readFileSync(perRunFile, "utf8"));

    const env = { ...process.env };
    delete env.SLACK_REGRESSION_WEBHOOK_URL;
    delete env.REGRESSION_ALERT_EMAIL;
    const proc = spawnSync(
      tsxBin,
      [notifyScript, "--history", canonical, "--no-archive"],
      { encoding: "utf8", cwd: tmpDir, env },
    );

    expect(proc.status, `stderr: ${proc.stderr}`).toBe(0);
    expect(proc.stdout).toMatch(/1 regression detected/);
    expect(proc.stdout).toMatch(/no notification channels configured/);
  }, 60_000);

  it("prints nothing-to-send when the history has only passing runs", () => {
    const historyFile = path.join(tmpDir, "e2e-history.jsonl");
    const passing: TestRecord = {
      journey: "candidate can sign in",
      file: "e2e/auth.spec.ts",
      status: "passed",
      quarantined: false,
      attempts: 1,
    };
    const lines: object[] = [];
    for (let i = 0; i < 15; i++) {
      const ts = `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`;
      lines.push(makeRun(`run-pass-${i}`, ts, [passing]));
    }
    writeHistory(historyFile, lines);

    const proc = spawnSync(
      tsxBin,
      [notifyScript, "--history", historyFile, "--no-archive"],
      { encoding: "utf8", cwd: tmpDir },
    );
    expect(proc.status, `stderr: ${proc.stderr}`).toBe(0);
    expect(proc.stdout).toMatch(/no regressions detected/);
  }, 60_000);
});
