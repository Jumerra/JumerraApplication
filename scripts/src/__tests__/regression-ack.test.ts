import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ackKey,
  isExpired,
  loadActiveAcks,
  readAcksRaw,
  writeAcks,
} from "../lib/regression-acks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(here, "..", "..");
const tsxBin = path.join(scriptsDir, "node_modules", ".bin", "tsx");
const ackScript = path.resolve(here, "..", "regression-ack.ts");
const reportScript = path.resolve(here, "..", "regression-report.ts");
const notifyScript = path.resolve(here, "..", "regression-notify.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-ack-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeHistoryWithRegression(file: string, journey: string, specFile: string): void {
  const passing = {
    journey,
    file: specFile,
    status: "passed" as const,
    quarantined: false,
    attempts: 1,
  };
  const failing = {
    journey,
    file: specFile,
    status: "failed" as const,
    quarantined: false,
    attempts: 1,
    reason: "boom",
  };
  const lines: object[] = [];
  for (let i = 0; i < 12; i++) {
    const ts = `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`;
    lines.push({
      schema: 1,
      runId: `run-pass-${i}`,
      finishedAt: ts,
      durationMs: 1000,
      results: [passing],
    });
  }
  lines.push({
    schema: 1,
    runId: "run-fail-1",
    finishedAt: "2026-05-15T12:00:00.000Z",
    durationMs: 1000,
    results: [failing],
  });
  lines.push({
    schema: 1,
    runId: "run-fail-2",
    finishedAt: "2026-05-16T12:00:00.000Z",
    durationMs: 1000,
    results: [failing],
  });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("regression-acks lib", () => {
  it("expired acks are dropped from loadActiveAcks but remain on disk", () => {
    const file = path.join(tmpDir, "acks.json");
    writeAcks(file, {
      acks: [
        { file: "a.spec.ts", journey: "j-active", until: "2999-01-01" },
        { file: "a.spec.ts", journey: "j-expired", until: "2000-01-01" },
        { file: "a.spec.ts", journey: "j-no-expiry" },
      ],
    });
    const active = loadActiveAcks(file);
    expect(active.has(ackKey("a.spec.ts", "j-active"))).toBe(true);
    expect(active.has(ackKey("a.spec.ts", "j-no-expiry"))).toBe(true);
    expect(active.has(ackKey("a.spec.ts", "j-expired"))).toBe(false);
    // Disk untouched
    const raw = readAcksRaw(file);
    expect(raw.acks).toHaveLength(3);
  });

  it("isExpired uses lexicographic YYYY-MM-DD comparison", () => {
    expect(isExpired({ file: "f", journey: "j", until: "2000-01-01" }, "2026-05-17")).toBe(true);
    expect(isExpired({ file: "f", journey: "j", until: "2026-05-17" }, "2026-05-17")).toBe(false);
    expect(isExpired({ file: "f", journey: "j", until: "2026-05-18" }, "2026-05-17")).toBe(false);
    expect(isExpired({ file: "f", journey: "j" }, "2026-05-17")).toBe(false);
  });

  it("readAcksRaw tolerates missing file and malformed JSON", () => {
    const missing = path.join(tmpDir, "missing.json");
    expect(readAcksRaw(missing).acks).toEqual([]);
    const bad = path.join(tmpDir, "bad.json");
    fs.writeFileSync(bad, "{not json");
    expect(readAcksRaw(bad).acks).toEqual([]);
  });
});

describe("regression-ack CLI", () => {
  it("adds, lists, and removes an ack", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    const add = spawnSync(
      tsxBin,
      [
        ackScript,
        "--acks",
        acksPath,
        "--journey",
        "candidate can sign in",
        "--file",
        "e2e/auth.spec.ts",
        "--until",
        "2999-01-01",
        "--reason",
        "JUM-123",
      ],
      { encoding: "utf8" },
    );
    expect(add.status, `stderr: ${add.stderr}`).toBe(0);
    expect(add.stdout).toMatch(/Added ack/);

    const raw = readAcksRaw(acksPath);
    expect(raw.acks).toEqual([
      {
        file: "e2e/auth.spec.ts",
        journey: "candidate can sign in",
        until: "2999-01-01",
        reason: "JUM-123",
      },
    ]);

    const list = spawnSync(
      tsxBin,
      [ackScript, "--acks", acksPath, "--list", "--json"],
      { encoding: "utf8" },
    );
    expect(list.status).toBe(0);
    const parsed = JSON.parse(list.stdout) as {
      total: number;
      acks: Array<{ journey: string; expired: boolean }>;
    };
    expect(parsed.total).toBe(1);
    expect(parsed.acks[0].expired).toBe(false);

    const remove = spawnSync(
      tsxBin,
      [
        ackScript,
        "--acks",
        acksPath,
        "--remove",
        "--journey",
        "candidate can sign in",
        "--file",
        "e2e/auth.spec.ts",
      ],
      { encoding: "utf8" },
    );
    expect(remove.status).toBe(0);
    expect(remove.stdout).toMatch(/Removed ack/);
    expect(readAcksRaw(acksPath).acks).toEqual([]);
  });

  it("rejects an invalid --until date", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    const proc = spawnSync(
      tsxBin,
      [
        ackScript,
        "--acks",
        acksPath,
        "--journey",
        "j",
        "--file",
        "f",
        "--until",
        "not-a-date",
      ],
      { encoding: "utf8" },
    );
    expect(proc.status).not.toBe(0);
    expect(proc.stderr).toMatch(/--until expects an ISO date/);
  });
});

describe("regression-report respects acks", () => {
  it("moves an acked regression out of regressions[] into acked[]", () => {
    const historyFile = path.join(tmpDir, "e2e-history.jsonl");
    const acksFile = path.join(tmpDir, "acks.json");
    const journey = "candidate can sign in";
    const specFile = "e2e/auth.spec.ts";
    makeHistoryWithRegression(historyFile, journey, specFile);

    // Without an ack: 1 active regression, 0 acked.
    const before = spawnSync(
      tsxBin,
      [
        reportScript,
        "--history",
        historyFile,
        "--acks",
        acksFile,
        "--no-archive",
        "--json",
      ],
      { encoding: "utf8" },
    );
    expect(before.status, `stderr: ${before.stderr}`).toBe(0);
    const beforeJson = JSON.parse(before.stdout) as {
      totalRegressions: number;
      totalAcked: number;
    };
    expect(beforeJson.totalRegressions).toBe(1);
    expect(beforeJson.totalAcked).toBe(0);

    // Add an ack.
    writeAcks(acksFile, {
      acks: [
        { file: specFile, journey, until: "2999-01-01", reason: "tracked" },
      ],
    });

    const after = spawnSync(
      tsxBin,
      [
        reportScript,
        "--history",
        historyFile,
        "--acks",
        acksFile,
        "--no-archive",
        "--json",
      ],
      { encoding: "utf8" },
    );
    expect(after.status).toBe(0);
    const afterJson = JSON.parse(after.stdout) as {
      totalRegressions: number;
      totalAcked: number;
      acked: Array<{ journey: string; ack: { reason?: string } }>;
    };
    expect(afterJson.totalRegressions).toBe(0);
    expect(afterJson.totalAcked).toBe(1);
    expect(afterJson.acked[0].journey).toBe(journey);
    expect(afterJson.acked[0].ack.reason).toBe("tracked");
  });

  it("expired acks no longer suppress — the regression re-surfaces", () => {
    const historyFile = path.join(tmpDir, "e2e-history.jsonl");
    const acksFile = path.join(tmpDir, "acks.json");
    const journey = "candidate can sign in";
    const specFile = "e2e/auth.spec.ts";
    makeHistoryWithRegression(historyFile, journey, specFile);
    writeAcks(acksFile, {
      acks: [{ file: specFile, journey, until: "2000-01-01" }],
    });

    const proc = spawnSync(
      tsxBin,
      [
        reportScript,
        "--history",
        historyFile,
        "--acks",
        acksFile,
        "--no-archive",
        "--json",
      ],
      { encoding: "utf8" },
    );
    expect(proc.status).toBe(0);
    const json = JSON.parse(proc.stdout) as {
      totalRegressions: number;
      totalAcked: number;
    };
    expect(json.totalRegressions).toBe(1);
    expect(json.totalAcked).toBe(0);
  });
});

describe("regression-notify respects acks", () => {
  it("acked regression suppresses the alert end-to-end", () => {
    const historyFile = path.join(tmpDir, "e2e-history.jsonl");
    const acksFile = path.join(tmpDir, "acks.json");
    const journey = "candidate can sign in";
    const specFile = "e2e/auth.spec.ts";
    makeHistoryWithRegression(historyFile, journey, specFile);
    writeAcks(acksFile, {
      acks: [{ file: specFile, journey, until: "2999-01-01" }],
    });

    const env = { ...process.env };
    delete env.SLACK_REGRESSION_WEBHOOK_URL;
    delete env.REGRESSION_ALERT_EMAIL;
    const proc = spawnSync(
      tsxBin,
      [
        notifyScript,
        "--history",
        historyFile,
        "--acks",
        acksFile,
        "--no-archive",
      ],
      { encoding: "utf8", cwd: tmpDir, env },
    );
    expect(proc.status, `stderr: ${proc.stderr}`).toBe(0);
    // Suppressed → notify sees zero regressions and short-circuits.
    expect(proc.stdout).toMatch(/no regressions detected/);
  }, 60_000);
});
