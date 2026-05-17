/**
 * Auto-remove the `test.info().annotations.push({ type: "quarantine", ... })`
 * call from any e2e test that the weekly flaky-report says is now stable.
 *
 * Pipeline:
 *   1. Shell out to `flaky-report --json` (or read a prebuilt JSON via
 *      `--report PATH`) and pull the `readyToUnquarantine` array.
 *   2. For each `{ journey, file }`, open the source file, locate the
 *      matching `test("<journey>", ...)` block, and strip any
 *      quarantine annotation push statement inside that block.
 *   3. Print a per-file summary. With `--dry-run`, no files are written.
 *
 * Safe to re-run: if nothing is ready, or the annotation is already
 * gone, the script exits 0 without modifying anything.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run unquarantine [--dry-run] [--report PATH]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface Candidate {
  journey: string;
  file: string;
}

interface Args {
  dryRun: boolean;
  reportPath: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, reportPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      // pnpm/npm sometimes forwards the `--` separator into argv;
      // skip it so it isn't treated as an unknown flag.
      continue;
    } else if (a === "--dry-run") {
      args.dryRun = true;
    } else if (a === "--report") {
      args.reportPath = argv[++i] ?? null;
      if (!args.reportPath) {
        throw new Error("--report expects a path");
      }
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: unquarantine [--dry-run] [--report PATH]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function loadCandidates(reportPath: string | null): Candidate[] {
  let raw: string;
  if (reportPath) {
    raw = fs.readFileSync(reportPath, "utf8");
  } else {
    const res = spawnSync(
      "pnpm",
      [
        "--filter",
        "@workspace/scripts",
        "run",
        "-s",
        "flaky-report",
        "--json",
      ],
      { encoding: "utf8" },
    );
    if (res.status !== 0) {
      throw new Error(
        `flaky-report exited with ${res.status}: ${res.stderr || res.stdout}`,
      );
    }
    raw = res.stdout;
  }
  // pnpm sometimes prepends a header line; extract the JSON object.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    readyToUnquarantine?: Candidate[];
  };
  return parsed.readyToUnquarantine ?? [];
}

/** The `journey` field is the joined titlePath ("Describe › name").
 *  Only the last segment is the actual `test("...")` title. */
function leafTitle(journey: string): string {
  const parts = journey.split(" \u203a ");
  return parts[parts.length - 1].trim();
}

/** Find the byte offset of the opening quote of `test("<title>", ...)`. */
function findTestStart(content: string, title: string): number {
  const variants = [
    JSON.stringify(title),
    `'${title.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
    `\`${title.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``,
  ];
  for (const v of variants) {
    let idx = 0;
    while ((idx = content.indexOf(v, idx)) !== -1) {
      const before = content.slice(Math.max(0, idx - 60), idx);
      if (/\btest(?:\.\w+)?\s*\(\s*$/.test(before)) {
        return idx;
      }
      idx += v.length;
    }
  }
  return -1;
}

/** Walk forward from `start` to the matching closing brace of the
 *  test body callback. Returns the offset of that closing `}` or -1. */
function findTestBodyEnd(content: string, start: number): number {
  const openIdx = content.indexOf("{", start);
  if (openIdx === -1) return -1;
  let depth = 0;
  let inStr: string | null = null;
  let esc = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openIdx; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const ANNOTATION_RE =
  /^[ \t]*test\.info\(\)\.annotations\.push\(\s*\{[\s\S]*?\}\s*\)\s*;?[ \t]*\r?\n?/gm;

function stripQuarantineAnnotation(body: string): {
  changed: boolean;
  output: string;
} {
  let changed = false;
  const output = body.replace(ANNOTATION_RE, (match) => {
    if (/type\s*:\s*["'`]quarantine["'`]/.test(match)) {
      changed = true;
      return "";
    }
    return match;
  });
  return { changed, output };
}

type Outcome = "removed" | "noop" | "missing-test" | "missing-file";

function processCandidate(
  c: Candidate,
  dryRun: boolean,
): { outcome: Outcome; diffPreview?: string } {
  const filePath = path.resolve(process.cwd(), c.file);
  if (!fs.existsSync(filePath)) return { outcome: "missing-file" };
  const content = fs.readFileSync(filePath, "utf8");
  const title = leafTitle(c.journey);
  const start = findTestStart(content, title);
  if (start === -1) return { outcome: "missing-test" };
  const end = findTestBodyEnd(content, start);
  if (end === -1) return { outcome: "missing-test" };
  const before = content.slice(0, start);
  const body = content.slice(start, end + 1);
  const after = content.slice(end + 1);
  const { changed, output } = stripQuarantineAnnotation(body);
  if (!changed) return { outcome: "noop" };
  if (!dryRun) {
    fs.writeFileSync(filePath, before + output + after);
  }
  // Build a tiny diff preview: show the removed lines.
  const removed = body
    .split("\n")
    .filter((line, idx, arr) => {
      const outLines = output.split("\n");
      return outLines[idx] !== line;
    })
    .slice(0, 6)
    .map((l) => `-${l}`)
    .join("\n");
  return { outcome: "removed", diffPreview: removed };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const candidates = loadCandidates(args.reportPath);
  if (candidates.length === 0) {
    process.stdout.write(
      "No quarantined journeys are ready to be unquarantined. Nothing to do.\n",
    );
    return;
  }
  process.stdout.write(
    `${args.dryRun ? "[dry-run] " : ""}Considering ${candidates.length} candidate(s):\n`,
  );
  let removed = 0;
  let noop = 0;
  let missing = 0;
  for (const c of candidates) {
    const { outcome, diffPreview } = processCandidate(c, args.dryRun);
    const tag =
      outcome === "removed"
        ? args.dryRun
          ? "WOULD REMOVE"
          : "REMOVED"
        : outcome === "noop"
          ? "ALREADY CLEAN"
          : outcome === "missing-file"
            ? "FILE NOT FOUND"
            : "TEST NOT FOUND";
    process.stdout.write(`  - [${tag}] ${c.file} :: ${c.journey}\n`);
    if (diffPreview) {
      for (const line of diffPreview.split("\n")) {
        process.stdout.write(`      ${line}\n`);
      }
    }
    if (outcome === "removed") removed++;
    else if (outcome === "noop") noop++;
    else missing++;
  }
  process.stdout.write(
    `\nSummary: ${removed} ${args.dryRun ? "would be removed" : "removed"}, ${noop} already clean, ${missing} not found.\n`,
  );
}

main();
