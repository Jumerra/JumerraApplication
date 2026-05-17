/**
 * Shared loader for the post-merge e2e history JSONL files.
 *
 * The post-merge reporter (`e2e/reporters/post-merge-reporter.ts`) writes
 * one JSON line per run to `.local/post-merge-logs/e2e-history.jsonl` and
 * trims old entries into monthly archives at
 * `.local/post-merge-logs/archive/e2e-history-YYYY-MM.jsonl`.
 *
 * Both `flaky-report` and `journey-history` need to read across the live
 * file plus (optionally) every archive file, dedupe by runId+finishedAt,
 * and sort oldest -> newest. That logic lives here so the two CLIs can't
 * drift.
 */
import fs from "node:fs";
import path from "node:path";

export interface HistoryTestRecord {
  journey: string;
  file: string;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  quarantined: boolean;
  reason?: string;
  attempts: number;
}

export interface HistoryRunRecord {
  schema: number;
  runId: string;
  finishedAt: string;
  durationMs: number;
  results: HistoryTestRecord[];
}

export function defaultHistoryPath(): string {
  return path.resolve(
    process.cwd(),
    ".local/post-merge-logs/e2e-history.jsonl",
  );
}

function readJsonlFile(file: string, into: HistoryRunRecord[]): void {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      into.push(JSON.parse(trimmed) as HistoryRunRecord);
    } catch {
      // skip malformed lines — better to surface a partial report than crash
    }
  }
}

export function readHistory(
  file: string,
  includeArchive: boolean,
): HistoryRunRecord[] {
  const runs: HistoryRunRecord[] = [];
  readJsonlFile(file, runs);
  if (includeArchive) {
    const archiveDir = path.join(path.dirname(file), "archive");
    if (fs.existsSync(archiveDir)) {
      const files = fs
        .readdirSync(archiveDir)
        .filter((n) => /^e2e-history-.+\.jsonl$/.test(n))
        .sort();
      for (const name of files) {
        readJsonlFile(path.join(archiveDir, name), runs);
      }
    }
  }
  // Oldest -> newest so quarantine-streak math reads naturally.
  // De-dupe by runId+finishedAt in case the live file and an archive overlap
  // (e.g. archived just before prune, then prune crashed).
  const seen = new Set<string>();
  const deduped: HistoryRunRecord[] = [];
  for (const r of runs) {
    const key = `${r.runId}\u0000${r.finishedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  deduped.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  return deduped;
}
