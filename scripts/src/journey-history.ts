/**
 * Single-journey history viewer.
 *
 * Reads the same JSONL data as `flaky-report` (live file + optional
 * archives) and prints a chronological pass / fail / quarantined
 * timeline for one journey. Useful for post-mortems when a test
 * started flaking months ago and you want to see the full streak
 * across the archive rather than the aggregate window flaky-report
 * shows.
 *
 *   pnpm --filter @workspace/scripts run journey-history -- --journey "candidate boost checkout"
 *   pnpm --filter @workspace/scripts run journey-history -- --file e2e/specs/boost.spec.ts --days 365
 *   pnpm --filter @workspace/scripts run journey-history -- --journey "..." --json
 *
 * Flags:
 *   --journey "<title>"  filter by exact journey title (case-sensitive)
 *   --file <path>        filter by spec file path (exact match)
 *   --days N             window size in days (default 90)
 *   --history PATH       override the JSONL location
 *   --no-archive         skip sibling archive/ JSONL files (archive is on by default
 *                        here since the point of this tool is reaching further back)
 *   --json               emit the structured timeline instead of a text table
 *
 * At least one of --journey / --file is required.
 */
import path from "node:path";
import {
  defaultHistoryPath,
  readHistory,
  type HistoryRunRecord,
  type HistoryTestRecord,
} from "./lib/e2e-history.js";

interface Args {
  journey?: string;
  file?: string;
  days: number;
  historyPath: string;
  includeArchive: boolean;
  json: boolean;
}

interface TimelinePoint {
  runId: string;
  finishedAt: string;
  status: HistoryTestRecord["status"] | "absent";
  quarantined: boolean;
  attempts: number;
  reason?: string;
}

function parseArgs(rawArgv: string[]): Args {
  // `pnpm run journey-history -- --journey ...` forwards `--` as a literal
  // argv entry in some pnpm versions; strip it so users can invoke the CLI
  // either way.
  const argv = rawArgv.filter((a) => a !== "--");
  const args: Args = {
    days: 90,
    historyPath: defaultHistoryPath(),
    includeArchive: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--journey") {
      args.journey = argv[++i];
    } else if (a === "--file") {
      args.file = argv[++i];
    } else if (a === "--days") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--days expects a positive number, got ${argv[i]}`);
      }
      args.days = n;
    } else if (a === "--history") {
      args.historyPath = path.resolve(argv[++i] ?? "");
    } else if (a === "--no-archive") {
      args.includeArchive = false;
    } else if (a === "--include-archive") {
      // Accepted for symmetry with flaky-report even though it's the default.
      args.includeArchive = true;
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: journey-history --journey \"<title>\" [--file PATH] [--days 90] " +
          "[--history PATH] [--no-archive] [--json]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!args.journey && !args.file) {
    throw new Error("must provide --journey or --file");
  }
  return args;
}

function matches(rec: HistoryTestRecord, args: Args): boolean {
  if (args.journey !== undefined && rec.journey !== args.journey) return false;
  if (args.file !== undefined && rec.file !== args.file) return false;
  return true;
}

function buildTimeline(
  runs: HistoryRunRecord[],
  args: Args,
  cutoffMs: number,
): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  for (const run of runs) {
    if (new Date(run.finishedAt).getTime() < cutoffMs) continue;
    const hits = run.results.filter((r) => matches(r, args));
    if (hits.length === 0) {
      // If the user filtered by --file (which may contain multiple
      // journeys) we don't manufacture an "absent" row — absence is
      // only meaningful for a single specific journey.
      if (args.journey !== undefined && args.file === undefined) {
        // Skip absent rows in the journey-only view too; including
        // them would drown the timeline with noise from every run
        // that didn't touch this test. A run where the journey is
        // missing is rarely interesting.
      }
      continue;
    }
    for (const hit of hits) {
      points.push({
        runId: run.runId,
        finishedAt: run.finishedAt,
        status: hit.status,
        quarantined: hit.quarantined,
        attempts: hit.attempts,
        reason: hit.reason,
      });
    }
  }
  return points;
}

function statusGlyph(p: TimelinePoint): string {
  if (p.quarantined) return "Q";
  switch (p.status) {
    case "passed":
      return "✓";
    case "failed":
    case "timedOut":
      return "✗";
    case "skipped":
      return "-";
    case "interrupted":
      return "!";
    default:
      return "?";
  }
}

function renderText(points: TimelinePoint[], args: Args, days: number): string {
  const lines: string[] = [];
  const label = args.journey ?? args.file ?? "(unknown)";
  lines.push(`# Journey history — ${label}`);
  lines.push(`Window: last ${days} day(s)`);
  lines.push(`Runs: ${points.length}`);
  if (points.length === 0) {
    lines.push("");
    lines.push("_No matching runs found._");
    return lines.join("\n");
  }

  let passes = 0;
  let failures = 0;
  let quarantined = 0;
  for (const p of points) {
    if (p.quarantined) quarantined += 1;
    if (p.status === "passed") passes += 1;
    else if (p.status === "failed" || p.status === "timedOut") failures += 1;
  }
  lines.push(
    `Passes: ${passes}   Failures: ${failures}   Quarantined runs: ${quarantined}`,
  );
  lines.push("");
  lines.push("| When (UTC) | Status | Q | Attempts | Run ID | Reason |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const p of points) {
    const reason = (p.reason ?? "").replace(/\|/g, "\\|");
    lines.push(
      `| ${p.finishedAt} | ${p.status} | ${statusGlyph(p)} | ${p.attempts} | ${p.runId} | ${reason} |`,
    );
  }
  return lines.join("\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const runs = readHistory(args.historyPath, args.includeArchive);
  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;
  const points = buildTimeline(runs, args, cutoff);

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          journey: args.journey,
          file: args.file,
          windowDays: args.days,
          historyPath: args.historyPath,
          includeArchive: args.includeArchive,
          totalPoints: points.length,
          timeline: points,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(`${renderText(points, args, args.days)}\n`);
}

main();
