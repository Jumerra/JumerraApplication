import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findExpiringAcks } from "../lib/regression-acks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(here, "..", "..");
const tsxBin = path.join(scriptsDir, "node_modules", ".bin", "tsx");
const reportScript = path.resolve(here, "..", "regression-report.ts");
const notifyScript = path.resolve(here, "..", "regression-notify.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-expiring-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAcksFile(dest: string, entries: object[]): void {
  fs.writeFileSync(dest, JSON.stringify({ acks: entries }, null, 2));
}

describe("findExpiringAcks", () => {
  it("returns acks whose `until` lies inside the window, sorted soonest-first", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcksFile(acksPath, [
      { file: "a.spec.ts", journey: "a", until: "2026-05-20" }, // 3 days
      { file: "b.spec.ts", journey: "b", until: "2026-05-17" }, // 0 days (today)
      { file: "c.spec.ts", journey: "c", until: "2026-05-30" }, // outside 7-day window
      { file: "d.spec.ts", journey: "d" }, // no expiry, skipped
      { file: "e.spec.ts", journey: "e", until: "2026-05-10" }, // already expired
    ]);
    const got = findExpiringAcks(acksPath, 7, "2026-05-17");
    expect(got.map((e) => e.ack.journey)).toEqual(["b", "a"]);
    expect(got[0].remainingDays).toBe(0);
    expect(got[1].remainingDays).toBe(3);
  });

  it("returns an empty list when there are no acks at all", () => {
    const acksPath = path.join(tmpDir, "missing.json");
    expect(findExpiringAcks(acksPath, 7, "2026-05-17")).toEqual([]);
  });

  it("ignores entries with malformed `until` dates", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcksFile(acksPath, [
      { file: "a.spec.ts", journey: "a", until: "not-a-date" },
      { file: "b.spec.ts", journey: "b", until: "2026-05-18" },
    ]);
    const got = findExpiringAcks(acksPath, 7, "2026-05-17");
    expect(got.map((e) => e.ack.journey)).toEqual(["b"]);
  });
});

describe("regression-report --expiring-window", () => {
  it("includes expiring acks in JSON output", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    const historyPath = path.join(tmpDir, "history.jsonl");
    fs.writeFileSync(historyPath, "");
    // Use a far-future date so the test isn't time-sensitive — the
    // window of 36500 days (~100 years) guarantees inclusion forever.
    writeAcksFile(acksPath, [
      {
        file: "auth.spec.ts",
        journey: "candidate can sign in",
        until: "2099-01-01",
        reason: "JUM-123",
      },
    ]);
    const proc = spawnSync(
      tsxBin,
      [
        reportScript,
        "--history",
        historyPath,
        "--acks",
        acksPath,
        "--no-archive",
        "--expiring-window",
        "36500",
        "--json",
      ],
      { encoding: "utf8", cwd: tmpDir },
    );
    expect(proc.status, `stderr: ${proc.stderr}`).toBe(0);
    const payload = JSON.parse(proc.stdout);
    expect(payload.expiringWindowDays).toBe(36500);
    expect(payload.totalExpiring).toBe(1);
    expect(payload.expiring[0].ack.journey).toBe("candidate can sign in");
    expect(payload.expiring[0].ack.until).toBe("2099-01-01");
    expect(payload.expiring[0].remainingDays).toBeGreaterThan(0);
  }, 60_000);

  it("omits expiring section when no acks are within the window", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    const historyPath = path.join(tmpDir, "history.jsonl");
    fs.writeFileSync(historyPath, "");
    writeAcksFile(acksPath, [
      { file: "a.spec.ts", journey: "a", until: "2099-01-01" },
    ]);
    const proc = spawnSync(
      tsxBin,
      [
        reportScript,
        "--history",
        historyPath,
        "--acks",
        acksPath,
        "--no-archive",
        "--expiring-window",
        "1",
      ],
      { encoding: "utf8", cwd: tmpDir },
    );
    expect(proc.status, `stderr: ${proc.stderr}`).toBe(0);
    expect(proc.stdout).not.toMatch(/Expiring acks/);
  }, 60_000);

  it("rejects a negative --expiring-window", () => {
    const proc = spawnSync(
      tsxBin,
      [reportScript, "--expiring-window", "-1"],
      { encoding: "utf8", cwd: tmpDir },
    );
    expect(proc.status).not.toBe(0);
    expect(proc.stderr).toMatch(/expiring-window/);
  }, 60_000);
});

describe("regression-notify --expiring-digest", () => {
  it("dispatches the expiring digest even when no regressions exist", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    const historyPath = path.join(tmpDir, "history.jsonl");
    fs.writeFileSync(historyPath, "");
    writeAcksFile(acksPath, [
      {
        file: "auth.spec.ts",
        journey: "candidate can sign in",
        until: "2099-01-01",
        reason: "JUM-123",
      },
    ]);
    const env = { ...process.env };
    delete env.SLACK_REGRESSION_WEBHOOK_URL;
    delete env.REGRESSION_ALERT_EMAIL;
    const proc = spawnSync(
      tsxBin,
      [
        notifyScript,
        "--history",
        historyPath,
        "--acks",
        acksPath,
        "--no-archive",
        "--expiring-window",
        "36500",
        "--expiring-digest",
      ],
      { encoding: "utf8", cwd: tmpDir, env },
    );
    expect(proc.status, `stderr: ${proc.stderr}`).toBe(0);
    expect(proc.stdout).toMatch(/no regressions detected/);
    expect(proc.stdout).toMatch(/expiring in the next/);
    expect(proc.stdout).toMatch(/dispatching digest/);
    expect(proc.stdout).toMatch(/no notification channels configured/);
  }, 60_000);

  it("stays quiet when --expiring-digest is not set", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    const historyPath = path.join(tmpDir, "history.jsonl");
    fs.writeFileSync(historyPath, "");
    writeAcksFile(acksPath, [
      {
        file: "auth.spec.ts",
        journey: "candidate can sign in",
        until: "2099-01-01",
      },
    ]);
    const env = { ...process.env };
    delete env.SLACK_REGRESSION_WEBHOOK_URL;
    delete env.REGRESSION_ALERT_EMAIL;
    const proc = spawnSync(
      tsxBin,
      [
        notifyScript,
        "--history",
        historyPath,
        "--acks",
        acksPath,
        "--no-archive",
        "--expiring-window",
        "36500",
      ],
      { encoding: "utf8", cwd: tmpDir, env },
    );
    expect(proc.status, `stderr: ${proc.stderr}`).toBe(0);
    expect(proc.stdout).toMatch(/no regressions detected/);
    expect(proc.stdout).not.toMatch(/dispatching digest/);
  }, 60_000);
});
