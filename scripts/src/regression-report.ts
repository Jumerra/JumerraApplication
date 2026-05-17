/**
 * Regression scanner for the post-merge e2e history.
 *
 * Walks every journey in the archive (live JSONL + monthly archives) and
 * flags ones whose **last N runs failed** after a **clean pass streak of
 * at least M runs**. These are silently-rotting tests that would not show
 * up in `flaky-report` (which highlights mixed pass/fail noise in a
 * recent window) — a journey that passes a hundred times in a row and
 * then starts failing is a *regression*, not flake, and the on-call
 * should know which day it broke.
 *
 *   pnpm --filter @workspace/scripts run regression-report
 *   pnpm --filter @workspace/scripts run regression-report -- --fails 3 --streak 20
 *   pnpm --filter @workspace/scripts run regression-report -- --json
 *
 * Flags:
 *   --fails N         consecutive failing runs at the tail (default 2)
 *   --streak M        min length of the clean pass streak before the
 *                     break (default 10)
 *   --history PATH    override the JSONL location
 *   --no-archive      skip sibling archive/ JSONL files (archive is on
 *                     by default — the whole point is reaching back)
 *   --json            emit structured data instead of a text table
 *
 * Output names the journey, the date the streak broke (= timestamp of
 * the first failing run after the streak), the streak length, and how
 * many consecutive failures followed so the on-call can prioritise.
 */
import path from "node:path";
import {
  defaultHistoryPath,
  readHistory,
  type HistoryRunRecord,
  type HistoryTestRecord,
} from "./lib/e2e-history.js";
import {
  ackKey,
  defaultAcksPath,
  loadActiveAcks,
  type RegressionAck,
} from "./lib/regression-acks.js";

interface Args {
  fails: number;
  streak: number;
  historyPath: string;
  acksPath: string;
  includeArchive: boolean;
  json: boolean;
}

interface Regression {
  journey: string;
  file: string;
  brokeAt: string;
  brokeRunId: string;
  streakLength: number;
  failingRuns: number;
  lastStatus: HistoryTestRecord["status"];
  lastReason?: string;
}

interface AckedRegression extends Regression {
  ack: RegressionAck;
}

function parseArgs(rawArgv: string[]): Args {
  const argv = rawArgv.filter((a) => a !== "--");
  const args: Args = {
    fails: 2,
    streak: 10,
    historyPath: defaultHistoryPath(),
    acksPath: defaultAcksPath(),
    includeArchive: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fails") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--fails expects a positive number, got ${argv[i]}`);
      }
      args.fails = n;
    } else if (a === "--streak") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--streak expects a positive number, got ${argv[i]}`);
      }
      args.streak = n;
    } else if (a === "--history") {
      args.historyPath = path.resolve(argv[++i] ?? "");
    } else if (a === "--acks") {
      args.acksPath = path.resolve(argv[++i] ?? "");
    } else if (a === "--no-archive") {
      args.includeArchive = false;
    } else if (a === "--include-archive") {
      args.includeArchive = true;
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: regression-report [--fails 2] [--streak 10] " +
          "[--history PATH] [--acks PATH] [--no-archive] [--json]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

interface AppearanceEntry {
  runId: string;
  finishedAt: string;
  rec: HistoryTestRecord;
}

function collectAppearances(
  runs: HistoryRunRecord[],
): Map<string, AppearanceEntry[]> {
  // Key by `${file}\u0000${journey}` so two tests with the same title in
  // different files don't collide.
  const map = new Map<string, AppearanceEntry[]>();
  for (const run of runs) {
    for (const rec of run.results) {
      const key = `${rec.file}\u0000${rec.journey}`;
      let arr = map.get(key);
      if (!arr) {
        arr = [];
        map.set(key, arr);
      }
      arr.push({ runId: run.runId, finishedAt: run.finishedAt, rec });
    }
  }
  return map;
}

function isFail(rec: HistoryTestRecord): boolean {
  return rec.status === "failed" || rec.status === "timedOut";
}

function isPass(rec: HistoryTestRecord): boolean {
  return rec.status === "passed";
}

function detectRegression(
  entries: AppearanceEntry[],
  failsRequired: number,
  streakRequired: number,
): Regression | null {
  // entries are oldest -> newest (readHistory sorted them).
  // Quarantined runs don't count toward fails or breaks (their result
  // is suppressed at merge-time and shouldn't be treated as a fresh
  // regression). Skipped/interrupted runs are noise — ignore them on
  // both sides so a single skip doesn't reset a real streak.
  const usable = entries.filter(
    (e) =>
      !e.rec.quarantined &&
      (isPass(e.rec) || isFail(e.rec)),
  );
  if (usable.length < failsRequired + streakRequired) return null;

  // Compute the full contiguous failing tail. We treat "≥ failsRequired"
  // as the threshold — a journey that has been failing for 5 runs after
  // a long pass streak is still the same regression, and the on-call
  // wants to know the *real* failing-tail length, not just the
  // threshold.
  let failTail = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    if (isFail(usable[i].rec)) {
      failTail += 1;
    } else {
      break;
    }
  }
  if (failTail < failsRequired) return null;

  const tailStart = usable.length - failTail;
  // The run just before the tail must be a pass (the failure has to
  // follow a clean streak — that's the regression signal).
  let streak = 0;
  for (let i = tailStart - 1; i >= 0; i--) {
    if (isPass(usable[i].rec)) {
      streak += 1;
    } else {
      break;
    }
  }
  if (streak < streakRequired) return null;

  const broke = usable[tailStart];
  const last = usable[usable.length - 1];
  return {
    journey: broke.rec.journey,
    file: broke.rec.file,
    brokeAt: broke.finishedAt,
    brokeRunId: broke.runId,
    streakLength: streak,
    failingRuns: failTail,
    lastStatus: last.rec.status,
    lastReason: last.rec.reason,
  };
}

function renderText(
  regressions: Regression[],
  acked: AckedRegression[],
  args: Args,
): string {
  const lines: string[] = [];
  lines.push("# Regression report");
  lines.push(
    `Criteria: ≥ ${args.streak} consecutive passes, then ≥ ${args.fails} consecutive failures at the tail.`,
  );
  lines.push("");
  if (regressions.length === 0) {
    lines.push("_No regressions detected — every previously-stable journey is still passing._");
    if (acked.length > 0) {
      lines.push("");
      lines.push(`_${acked.length} regression${acked.length === 1 ? " is" : "s are"} currently acked and suppressed (see below)._`);
      appendAckedTable(lines, acked);
    }
    return lines.join("\n");
  }
  // Most recent break first so the on-call sees today's incidents at the top.
  const sorted = [...regressions].sort((a, b) =>
    b.brokeAt.localeCompare(a.brokeAt),
  );
  lines.push("| Broke at (UTC) | Journey | File | Prior streak | Failing runs | Last status | Reason |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of sorted) {
    const reason = (r.lastReason ?? "").replace(/\|/g, "\\|");
    lines.push(
      `| ${r.brokeAt} | ${r.journey} | ${r.file} | ${r.streakLength} | ${r.failingRuns} | ${r.lastStatus} | ${reason} |`,
    );
  }
  if (acked.length > 0) {
    appendAckedTable(lines, acked);
  }
  return lines.join("\n");
}

function appendAckedTable(lines: string[], acked: AckedRegression[]): void {
  lines.push("");
  lines.push(`## Acked (suppressed) — ${acked.length}`);
  lines.push("| Broke at (UTC) | Journey | File | Acked until | Ack reason |");
  lines.push("| --- | --- | --- | --- | --- |");
  const sorted = [...acked].sort((a, b) => b.brokeAt.localeCompare(a.brokeAt));
  for (const r of sorted) {
    const until = r.ack.until ?? "(no expiry)";
    const reason = (r.ack.reason ?? "").replace(/\|/g, "\\|");
    lines.push(
      `| ${r.brokeAt} | ${r.journey} | ${r.file} | ${until} | ${reason} |`,
    );
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const runs = readHistory(args.historyPath, args.includeArchive);
  const appearances = collectAppearances(runs);

  const acks = loadActiveAcks(args.acksPath);
  const regressions: Regression[] = [];
  const acked: AckedRegression[] = [];
  for (const entries of appearances.values()) {
    const r = detectRegression(entries, args.fails, args.streak);
    if (!r) continue;
    const ack = acks.get(ackKey(r.file, r.journey));
    if (ack) {
      acked.push({ ...r, ack });
    } else {
      regressions.push(r);
    }
  }

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          criteria: { fails: args.fails, streak: args.streak },
          historyPath: args.historyPath,
          acksPath: args.acksPath,
          includeArchive: args.includeArchive,
          totalRegressions: regressions.length,
          regressions,
          totalAcked: acked.length,
          acked,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(`${renderText(regressions, acked, args)}\n`);
}

main();
