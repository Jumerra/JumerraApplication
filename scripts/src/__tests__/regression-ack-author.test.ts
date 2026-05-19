import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bucketByAuthor,
  classifyAuthor,
  readAcksRaw,
  writeAcks,
} from "../lib/regression-acks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(here, "..", "..");
const tsxBin = path.join(scriptsDir, "node_modules", ".bin", "tsx");
const ackScript = path.resolve(here, "..", "regression-ack.ts");
const notifyScript = path.resolve(here, "..", "regression-notify.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-ack-author-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("classifyAuthor", () => {
  it("recognises emails", () => {
    expect(classifyAuthor("jane@example.com")).toBe("email");
    expect(classifyAuthor("  jane.doe+tag@sub.example.co  ")).toBe("email");
  });

  it("recognises Slack handles and member ids", () => {
    expect(classifyAuthor("@jane")).toBe("slack");
    expect(classifyAuthor("U012ABCDEF")).toBe("slack");
    expect(classifyAuthor("W012ABCDEF")).toBe("slack");
    expect(classifyAuthor("<@U012ABCDEF>")).toBe("slack");
  });

  it("treats blank/unrecognised input as unknown", () => {
    expect(classifyAuthor(undefined)).toBe("unknown");
    expect(classifyAuthor("")).toBe("unknown");
    expect(classifyAuthor("   ")).toBe("unknown");
    expect(classifyAuthor("just-a-name")).toBe("unknown");
  });
});

describe("bucketByAuthor", () => {
  it("groups entries by author kind and falls back to unattributed", () => {
    const mk = (author: string | undefined, journey: string) => ({
      ack: { file: "f.spec.ts", journey, author },
      remainingDays: 1,
    });
    const buckets = bucketByAuthor([
      mk("jane@example.com", "a"),
      mk("jane@example.com", "b"),
      mk("@bob", "c"),
      mk(undefined, "d"),
      mk("not-routable", "e"),
    ]);
    expect(buckets.emails.get("jane@example.com")?.map((e) => e.ack.journey)).toEqual([
      "a",
      "b",
    ]);
    expect(buckets.slack.get("@bob")?.map((e) => e.ack.journey)).toEqual(["c"]);
    expect(buckets.unattributed.map((e) => e.ack.journey)).toEqual(["d", "e"]);
  });
});

describe("regression-ack CLI --author", () => {
  it("persists the author field and shows it in --list", () => {
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
        "--author",
        "jane@example.com",
      ],
      { encoding: "utf8" },
    );
    expect(add.status, `stderr: ${add.stderr}`).toBe(0);
    const raw = readAcksRaw(acksPath);
    expect(raw.acks[0]).toMatchObject({
      author: "jane@example.com",
      journey: "candidate can sign in",
      file: "e2e/auth.spec.ts",
    });

    const list = spawnSync(
      tsxBin,
      [ackScript, "--acks", acksPath, "--list"],
      { encoding: "utf8" },
    );
    expect(list.status).toBe(0);
    expect(list.stdout).toMatch(/\[by jane@example\.com\]/);
  }, 30_000);
});

describe("regression-notify --expiring-digest with authors", () => {
  it("pings each email author individually and broadcasts the unattributed", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    const historyPath = path.join(tmpDir, "history.jsonl");
    fs.writeFileSync(historyPath, "");
    writeAcks(acksPath, {
      acks: [
        {
          file: "a.spec.ts",
          journey: "a",
          until: "2099-01-01",
          author: "jane@example.com",
        },
        {
          file: "b.spec.ts",
          journey: "b",
          until: "2099-01-01",
          author: "bob@example.com",
        },
        {
          file: "c.spec.ts",
          journey: "c",
          until: "2099-01-01",
          // no author — falls back to broadcast
        },
      ],
    });

    const env = { ...process.env };
    delete env.SLACK_REGRESSION_WEBHOOK_URL;
    delete env.REGRESSION_ALERT_EMAIL;
    // No RESEND_API_KEY either: per-author email pings still attempt
    // (and skip with a stderr warning) but we don't actually send.
    delete env.RESEND_API_KEY;
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
    expect(proc.stdout).toMatch(/dispatching digest/);
    expect(proc.stdout).toMatch(/pinging ack author jane@example\.com/);
    expect(proc.stdout).toMatch(/pinging ack author bob@example\.com/);
    // Two emails attempted, RESEND_API_KEY missing → two skip warnings.
    expect(proc.stderr).toMatch(/RESEND_API_KEY missing/);
  }, 60_000);

  it("falls back to the broadcast channel when no author is recorded", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    const historyPath = path.join(tmpDir, "history.jsonl");
    fs.writeFileSync(historyPath, "");
    writeAcks(acksPath, {
      acks: [
        { file: "a.spec.ts", journey: "a", until: "2099-01-01" },
      ],
    });
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
    expect(proc.stdout).toMatch(/dispatching digest/);
    // Existing behaviour preserved: no channels configured → existing log.
    expect(proc.stdout).toMatch(/no notification channels configured/);
    // No per-author ping fired.
    expect(proc.stdout).not.toMatch(/pinging ack author/);
  }, 60_000);
});
