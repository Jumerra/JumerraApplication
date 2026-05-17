import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  archiveDroppedLines,
  pruneHistory,
} from "../reporters/post-merge-reporter.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeRow(finishedAt: string, runId = finishedAt): string {
  return JSON.stringify({
    schema: 1,
    runId,
    finishedAt,
    durationMs: 1,
    results: [],
  });
}

function readJsonl(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
}

describe("post-merge-reporter archive + prune", () => {
  let tmpDir: string;
  let historyFile: string;
  let archiveDir: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmr-test-"));
    historyFile = path.join(tmpDir, "e2e-history.jsonl");
    archiveDir = path.join(tmpDir, "archive");
    delete process.env.E2E_HISTORY_RETENTION_DAYS;
    delete process.env.E2E_ARCHIVE_RETENTION_MONTHS;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("archiveDroppedLines", () => {
    it("buckets rows into YYYY-MM files by finishedAt", () => {
      const rows = [
        makeRow("2025-01-15T10:00:00.000Z"),
        makeRow("2025-01-20T10:00:00.000Z"),
        makeRow("2025-03-01T10:00:00.000Z"),
      ];
      archiveDroppedLines(archiveDir, rows);

      const jan = path.join(archiveDir, "e2e-history-2025-01.jsonl");
      const mar = path.join(archiveDir, "e2e-history-2025-03.jsonl");
      expect(readJsonl(jan)).toHaveLength(2);
      expect(readJsonl(mar)).toHaveLength(1);
    });

    it("buckets unparseable lines into the 'unknown' file instead of dropping them", () => {
      archiveDroppedLines(archiveDir, ["not-json{", "also bad"]);
      const unknown = path.join(archiveDir, "e2e-history-unknown.jsonl");
      expect(readJsonl(unknown)).toEqual(["not-json{", "also bad"]);
    });

    it("appends to an existing monthly bucket instead of overwriting it", () => {
      archiveDroppedLines(archiveDir, [makeRow("2025-02-01T10:00:00.000Z", "a")]);
      archiveDroppedLines(archiveDir, [makeRow("2025-02-05T10:00:00.000Z", "b")]);
      const feb = path.join(archiveDir, "e2e-history-2025-02.jsonl");
      expect(readJsonl(feb)).toHaveLength(2);
    });

    it("caps archive at E2E_ARCHIVE_RETENTION_MONTHS, evicting oldest first", () => {
      process.env.E2E_ARCHIVE_RETENTION_MONTHS = "3";
      const months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"];
      for (const m of months) {
        archiveDroppedLines(archiveDir, [makeRow(`${m}-10T10:00:00.000Z`)]);
      }
      const remaining = fs.readdirSync(archiveDir).sort();
      expect(remaining).toEqual([
        "e2e-history-2025-03.jsonl",
        "e2e-history-2025-04.jsonl",
        "e2e-history-2025-05.jsonl",
      ]);
    });

    it("defaults retention to 12 months", () => {
      const months: string[] = [];
      for (let i = 1; i <= 14; i++) {
        const mm = i.toString().padStart(2, "0");
        const yyyy = i <= 12 ? "2024" : "2025";
        const monthIdx = i <= 12 ? mm : (i - 12).toString().padStart(2, "0");
        months.push(`${yyyy}-${monthIdx}`);
      }
      for (const m of months) {
        archiveDroppedLines(archiveDir, [makeRow(`${m}-10T10:00:00.000Z`)]);
      }
      const remaining = fs.readdirSync(archiveDir);
      expect(remaining).toHaveLength(12);
      expect(remaining).not.toContain("e2e-history-2024-01.jsonl");
      expect(remaining).not.toContain("e2e-history-2024-02.jsonl");
      expect(remaining).toContain("e2e-history-2025-02.jsonl");
    });

    it("is a no-op when no lines are dropped", () => {
      archiveDroppedLines(archiveDir, []);
      expect(fs.existsSync(archiveDir)).toBe(false);
    });
  });

  describe("pruneHistory", () => {
    it("archives rows older than retention and keeps newer rows in the live file", () => {
      process.env.E2E_HISTORY_RETENTION_DAYS = "30";
      const now = Date.parse("2025-06-01T00:00:00.000Z");
      const oldRow = makeRow("2025-01-15T10:00:00.000Z");
      const olderRow = makeRow("2025-02-20T10:00:00.000Z");
      const freshRow = makeRow("2025-05-25T10:00:00.000Z");
      fs.writeFileSync(historyFile, `${oldRow}\n${olderRow}\n${freshRow}\n`);

      pruneHistory(historyFile, now);

      const liveRows = readJsonl(historyFile);
      expect(liveRows).toEqual([freshRow]);

      const jan = path.join(archiveDir, "e2e-history-2025-01.jsonl");
      const feb = path.join(archiveDir, "e2e-history-2025-02.jsonl");
      expect(readJsonl(jan)).toEqual([oldRow]);
      expect(readJsonl(feb)).toEqual([olderRow]);
      expect(
        fs.existsSync(path.join(archiveDir, "e2e-history-2025-05.jsonl")),
      ).toBe(false);
    });

    it("does not touch the live file or archive when nothing is past retention", () => {
      process.env.E2E_HISTORY_RETENTION_DAYS = "30";
      const now = Date.now();
      const freshRow = makeRow(new Date(now - 1 * DAY_MS).toISOString());
      fs.writeFileSync(historyFile, `${freshRow}\n`);

      pruneHistory(historyFile, now);

      expect(readJsonl(historyFile)).toEqual([freshRow]);
      expect(fs.existsSync(archiveDir)).toBe(false);
    });

    it("keeps unparseable lines in the live file (better to keep junk than lose data)", () => {
      process.env.E2E_HISTORY_RETENTION_DAYS = "30";
      const now = Date.parse("2025-06-01T00:00:00.000Z");
      const oldRow = makeRow("2025-01-15T10:00:00.000Z");
      const junk = "not-json{";
      fs.writeFileSync(historyFile, `${oldRow}\n${junk}\n`);

      pruneHistory(historyFile, now);

      expect(readJsonl(historyFile)).toEqual([junk]);
      const jan = path.join(archiveDir, "e2e-history-2025-01.jsonl");
      expect(readJsonl(jan)).toEqual([oldRow]);
    });

    it("disables pruning when retention is 0 or non-finite", () => {
      process.env.E2E_HISTORY_RETENTION_DAYS = "0";
      const oldRow = makeRow("2020-01-15T10:00:00.000Z");
      fs.writeFileSync(historyFile, `${oldRow}\n`);

      pruneHistory(historyFile, Date.now());

      expect(readJsonl(historyFile)).toEqual([oldRow]);
      expect(fs.existsSync(archiveDir)).toBe(false);
    });

    it("respects the archive cap when prune evicts many months at once", () => {
      process.env.E2E_HISTORY_RETENTION_DAYS = "30";
      process.env.E2E_ARCHIVE_RETENTION_MONTHS = "2";
      const now = Date.parse("2025-06-01T00:00:00.000Z");
      const rows = [
        makeRow("2025-01-10T10:00:00.000Z"),
        makeRow("2025-02-10T10:00:00.000Z"),
        makeRow("2025-03-10T10:00:00.000Z"),
        makeRow("2025-04-10T10:00:00.000Z"),
      ];
      fs.writeFileSync(historyFile, `${rows.join("\n")}\n`);

      pruneHistory(historyFile, now);

      const remaining = fs.readdirSync(archiveDir).sort();
      expect(remaining).toEqual([
        "e2e-history-2025-03.jsonl",
        "e2e-history-2025-04.jsonl",
      ]);
    });
  });
});
