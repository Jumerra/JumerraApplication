/**
 * Weekly flaky-journey health report.
 *
 * Reads the per-run JSONL written by `e2e/reporters/post-merge-reporter.ts`
 * (`.local/post-merge-logs/e2e-history.jsonl`) and prints a markdown
 * summary of the last 7 days of e2e activity:
 *
 *   - which journeys are currently quarantined and for how long
 *   - their pass / fail counts and pass rate in the window
 *   - any non-quarantined journeys that flaked (mix of pass + fail)
 *
 * The output is plain markdown so it can be pasted straight into the
 * team's weekly review notes. Run it with:
 *
 *   pnpm --filter @workspace/scripts run flaky-report
 *
 * Flags:
 *   --days N        window size in days (default 7)
 *   --history PATH  override the JSONL location
 *   --json          emit the structured summary instead of markdown
 */
import fs from "node:fs";
import path from "node:path";

interface HistoryTestRecord {
  journey: string;
  file: string;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  quarantined: boolean;
  reason?: string;
  attempts: number;
}

interface HistoryRunRecord {
  schema: number;
  runId: string;
  finishedAt: string;
  durationMs: number;
  results: HistoryTestRecord[];
}

interface JourneyStats {
  journey: string;
  file: string;
  runs: number;
  /** Runs that produced a real outcome (passed/failed/timedOut). Used
   *  as the pass-rate denominator so a journey that was skipped this
   *  week doesn't get a misleading 0% rate. */
  executed: number;
  passes: number;
  failures: number;
  quarantinedRuns: number;
  lastStatus: HistoryTestRecord["status"];
  lastQuarantined: boolean;
  lastReason?: string;
  quarantinedSince?: string;
  quarantinedDays?: number;
}

interface Args {
  days: number;
  historyPath: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    days: 7,
    historyPath: path.resolve(
      process.cwd(),
      ".local/post-merge-logs/e2e-history.jsonl",
    ),
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--days expects a positive number, got ${argv[i]}`);
      }
      args.days = n;
    } else if (a === "--history") {
      args.historyPath = path.resolve(argv[++i] ?? "");
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: flaky-report [--days 7] [--history PATH] [--json]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function readHistory(file: string): HistoryRunRecord[] {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const runs: HistoryRunRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      runs.push(JSON.parse(trimmed) as HistoryRunRecord);
    } catch {
      // skip malformed lines — better to surface a partial report than crash
    }
  }
  // Oldest -> newest so quarantine-streak math reads naturally.
  runs.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  return runs;
}

function computeStats(
  runs: HistoryRunRecord[],
  windowMs: number,
  now: number,
): JourneyStats[] {
  const cutoff = now - windowMs;
  const windowRuns = runs.filter(
    (r) => new Date(r.finishedAt).getTime() >= cutoff,
  );

  const byJourney = new Map<string, JourneyStats>();

  for (const run of windowRuns) {
    for (const res of run.results) {
      const key = `${res.file}\u0000${res.journey}`;
      let s = byJourney.get(key);
      if (!s) {
        s = {
          journey: res.journey,
          file: res.file,
          runs: 0,
          executed: 0,
          passes: 0,
          failures: 0,
          quarantinedRuns: 0,
          lastStatus: res.status,
          lastQuarantined: res.quarantined,
          lastReason: res.reason,
        };
        byJourney.set(key, s);
      }
      s.runs += 1;
      if (res.status === "passed") {
        s.passes += 1;
        s.executed += 1;
      } else if (res.status === "failed" || res.status === "timedOut") {
        s.failures += 1;
        s.executed += 1;
      }
      if (res.quarantined) s.quarantinedRuns += 1;
      // runs are oldest-first, so the final assignment is the latest
      s.lastStatus = res.status;
      s.lastQuarantined = res.quarantined;
      s.lastReason = res.reason ?? s.lastReason;
    }
  }

  // For currently-quarantined journeys, walk the FULL history (not
  // just the window) backwards from the most recent run to find the
  // first run in the current quarantine streak. "Streak" = consecutive
  // runs where the journey appeared with quarantined=true. A run in
  // which the journey didn't appear at all breaks the streak.
  for (const [key, s] of byJourney) {
    if (!s.lastQuarantined) continue;
    let streakStartIso: string | undefined;
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i];
      const hit = run.results.find(
        (r) => `${r.file}\u0000${r.journey}` === key,
      );
      if (!hit) break;
      if (!hit.quarantined) break;
      streakStartIso = run.finishedAt;
    }
    if (streakStartIso) {
      s.quarantinedSince = streakStartIso;
      s.quarantinedDays = Math.max(
        0,
        Math.floor(
          (now - new Date(streakStartIso).getTime()) / (24 * 60 * 60 * 1000),
        ),
      );
    }
  }

  return [...byJourney.values()];
}

function fmtPassRate(s: JourneyStats): string {
  // Use executed runs (pass + fail + timedOut) as the denominator so a
  // journey that was skipped or interrupted in some runs isn't given
  // an artificially low pass rate.
  if (s.executed === 0) return "n/a";
  const pct = (s.passes / s.executed) * 100;
  return `${pct.toFixed(0)}% (${s.passes}/${s.executed})`;
}

function renderMarkdown(
  stats: JourneyStats[],
  days: number,
  totalRuns: number,
): string {
  const quarantined = stats
    .filter((s) => s.lastQuarantined)
    .sort((a, b) => (b.quarantinedDays ?? 0) - (a.quarantinedDays ?? 0));

  // A journey is "flaky but not quarantined" if it had both passes
  // and failures in the window without being on the quarantine list.
  const flaky = stats
    .filter((s) => !s.lastQuarantined && s.passes > 0 && s.failures > 0)
    .sort((a, b) => b.failures - a.failures);

  const lines: string[] = [];
  lines.push(`# E2E health report — last ${days} day(s)`);
  lines.push("");
  lines.push(`Runs in window: **${totalRuns}**`);
  lines.push(`Journeys observed: **${stats.length}**`);
  lines.push(`Quarantined: **${quarantined.length}**`);
  lines.push(`Flaky (not quarantined): **${flaky.length}**`);
  lines.push("");

  // A quarantined journey is a "candidate to unquarantine" if it ran
  // at least once in the window AND every executed run passed (no
  // failures, no timeouts). Skipped/interrupted runs don't count
  // either way — they're excluded from `executed` already.
  const readyToUnquarantine = quarantined.filter(
    (s) => s.executed > 0 && s.failures === 0,
  );

  lines.push("## Quarantined journeys");
  if (quarantined.length === 0) {
    lines.push("_None — quarantine list is empty._");
  } else {
    lines.push(
      "| Journey | Quarantined for | Pass rate | Reason |",
    );
    lines.push("| --- | --- | --- | --- |");
    for (const s of quarantined) {
      const since =
        s.quarantinedDays !== undefined
          ? `${s.quarantinedDays} day(s)`
          : "current run";
      const reason = (s.lastReason ?? "(no reason given)").replace(
        /\|/g,
        "\\|",
      );
      lines.push(
        `| ${s.journey} | ${since} | ${fmtPassRate(s)} | ${reason} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Candidates to unquarantine");
  if (readyToUnquarantine.length === 0) {
    lines.push(
      "_None — no quarantined journey has a perfect pass rate in the window._",
    );
  } else {
    lines.push(
      `These quarantined journeys passed every executed run in the last ${days} day(s). Consider removing their \`test.info().annotations.push({ type: "quarantine", ... })\` call.`,
    );
    lines.push("");
    lines.push("| Journey | File | Quarantined for | Pass rate |");
    lines.push("| --- | --- | --- | --- |");
    for (const s of readyToUnquarantine) {
      const since =
        s.quarantinedDays !== undefined
          ? `${s.quarantinedDays} day(s)`
          : "current run";
      lines.push(
        `| ${s.journey} | ${s.file} | ${since} | ${fmtPassRate(s)} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Flaky but not quarantined");
  if (flaky.length === 0) {
    lines.push("_None — every non-quarantined journey was consistent._");
  } else {
    lines.push("| Journey | Pass rate | Failures |");
    lines.push("| --- | --- | --- |");
    for (const s of flaky) {
      lines.push(`| ${s.journey} | ${fmtPassRate(s)} | ${s.failures} |`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const runs = readHistory(args.historyPath);
  const now = Date.now();
  const windowMs = args.days * 24 * 60 * 60 * 1000;
  const totalRuns = runs.filter(
    (r) => new Date(r.finishedAt).getTime() >= now - windowMs,
  ).length;
  const stats = computeStats(runs, windowMs, now);

  if (args.json) {
    const readyToUnquarantine = stats
      .filter((s) => s.lastQuarantined && s.executed > 0 && s.failures === 0)
      .map((s) => ({ journey: s.journey, file: s.file }));
    process.stdout.write(
      `${JSON.stringify(
        {
          windowDays: args.days,
          totalRuns,
          journeys: stats,
          readyToUnquarantine,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (runs.length === 0) {
    process.stdout.write(
      `# E2E health report\n\n_No history found at \`${args.historyPath}\`._\n` +
        "Run the post-merge suite at least once to populate it.\n",
    );
    return;
  }

  process.stdout.write(`${renderMarkdown(stats, args.days, totalRuns)}\n`);
}

main();
