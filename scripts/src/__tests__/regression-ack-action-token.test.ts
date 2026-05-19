import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySignedAckAction,
  buildAckActionUrls,
  readAcksRaw,
  signAckActionToken,
  verifyAckActionToken,
  writeAcks,
} from "../lib/regression-acks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(here, "..", "..");
const tsxBin = path.join(scriptsDir, "node_modules", ".bin", "tsx");
const ackScript = path.resolve(here, "..", "regression-ack.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ack-action-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("signAckActionToken / verifyAckActionToken", () => {
  const secret = "test-secret";

  it("round-trips a payload exactly", () => {
    const token = signAckActionToken({
      action: "extend7",
      file: "e2e/auth.spec.ts",
      journey: "candidate can sign in",
      untilSnapshot: "2026-06-01",
      secret,
      now: 1_700_000_000,
      nonce: "deadbeef",
    });
    const v = verifyAckActionToken(token, secret, 1_700_000_000);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.payload.action).toBe("extend7");
    expect(v.payload.file).toBe("e2e/auth.spec.ts");
    expect(v.payload.journey).toBe("candidate can sign in");
    expect(v.payload.untilSnapshot).toBe("2026-06-01");
    expect(v.payload.nonce).toBe("deadbeef");
    expect(v.payload.expiresAt).toBe(1_700_000_000 + 14 * 24 * 60 * 60);
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = signAckActionToken({
      action: "close",
      file: "f",
      journey: "j",
      untilSnapshot: "",
      secret,
    });
    const v = verifyAckActionToken(token, "different-secret");
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("bad-signature");
  });

  it("rejects a tampered payload (action upgrade attack)", () => {
    const token = signAckActionToken({
      action: "extend7",
      file: "f",
      journey: "j",
      untilSnapshot: "",
      secret,
    });
    // Swap payload body for a "close" action; signature won't match.
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        a: "close",
        f: "f",
        j: "j",
        u: "",
        e: Math.floor(Date.now() / 1000) + 60,
        n: "x",
      }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const v = verifyAckActionToken(`${forged}.${sig}`, secret);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("bad-signature");
  });

  it("rejects an expired token", () => {
    const token = signAckActionToken({
      action: "extend7",
      file: "f",
      journey: "j",
      untilSnapshot: "",
      secret,
      now: 1_000,
      ttlSeconds: 10,
    });
    const v = verifyAckActionToken(token, secret, 2_000);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("expired");
  });

  it("rejects malformed tokens", () => {
    expect(verifyAckActionToken("", secret).ok).toBe(false);
    expect(verifyAckActionToken("no-dot", secret).ok).toBe(false);
    expect(verifyAckActionToken("only.", secret).ok).toBe(false);
    expect(verifyAckActionToken(".only", secret).ok).toBe(false);
  });
});

describe("buildAckActionUrls", () => {
  it("appends ?t= when base has no query, &t= when it does", () => {
    const a = buildAckActionUrls({
      baseUrl: "https://example.com/ack",
      secret: "s",
      file: "f",
      journey: "j",
      untilSnapshot: "",
    });
    expect(a.extend7).toMatch(/^https:\/\/example\.com\/ack\?t=/);
    const b = buildAckActionUrls({
      baseUrl: "https://example.com/ack?source=mail",
      secret: "s",
      file: "f",
      journey: "j",
      untilSnapshot: "",
    });
    expect(b.extend30).toMatch(/^https:\/\/example\.com\/ack\?source=mail&t=/);
  });

  it("emits three distinct tokens (one per action)", () => {
    const urls = buildAckActionUrls({
      baseUrl: "https://e/",
      secret: "s",
      file: "f",
      journey: "j",
      untilSnapshot: "2026-01-01",
    });
    expect(urls.extend7).not.toBe(urls.extend30);
    expect(urls.extend30).not.toBe(urls.close);
    expect(urls.extend7).not.toBe(urls.close);
  });
});

describe("applySignedAckAction", () => {
  it("extends an ack from max(currentUntil, today) and rejects a replay", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcks(acksPath, {
      acks: [{ file: "f", journey: "j", until: "2026-06-01" }],
    });
    const result = applySignedAckAction(
      acksPath,
      {
        action: "extend7",
        file: "f",
        journey: "j",
        untilSnapshot: "2026-06-01",
        expiresAt: 0,
        nonce: "n",
      },
      "2026-05-20",
    );
    expect(result.code).toBe("applied-extend");
    // current `until` is in the future, so we extend from `until`, not today.
    expect(result.newUntil).toBe("2026-06-08");
    expect(readAcksRaw(acksPath).acks[0].until).toBe("2026-06-08");

    // Replay with same token (same snapshot) — current `until` no
    // longer matches, so the second click is rejected.
    const replay = applySignedAckAction(
      acksPath,
      {
        action: "extend7",
        file: "f",
        journey: "j",
        untilSnapshot: "2026-06-01",
        expiresAt: 0,
        nonce: "n",
      },
      "2026-05-20",
    );
    expect(replay.code).toBe("stale-snapshot");
  });

  it("extend never shortens an active ack (regression guard)", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcks(acksPath, {
      acks: [{ file: "f", journey: "j", until: "2026-08-01" }],
    });
    const result = applySignedAckAction(
      acksPath,
      {
        action: "extend7",
        file: "f",
        journey: "j",
        untilSnapshot: "2026-08-01",
        expiresAt: 0,
        nonce: "n",
      },
      "2026-05-20",
    );
    expect(result.code).toBe("applied-extend");
    // Must be later than the existing 2026-08-01, never earlier.
    expect(result.newUntil! > "2026-08-01").toBe(true);
    expect(result.newUntil).toBe("2026-08-08");
  });

  it("extend bases off today when current `until` is already in the past", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    // Edge case: an ack whose `until` slipped into the past between
    // sign and apply (e.g. token issued near midnight). We must not
    // extend backwards from there.
    writeAcks(acksPath, {
      acks: [{ file: "f", journey: "j", until: "2026-05-10" }],
    });
    const result = applySignedAckAction(
      acksPath,
      {
        action: "extend30",
        file: "f",
        journey: "j",
        untilSnapshot: "2026-05-10",
        expiresAt: 0,
        nonce: "n",
      },
      "2026-05-20",
    );
    expect(result.code).toBe("applied-extend");
    expect(result.newUntil).toBe("2026-06-19");
  });

  it("close-token replay after ack re-creation is rejected as stale", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcks(acksPath, {
      acks: [{ file: "f", journey: "j", until: "2026-06-01" }],
    });
    // First close — snapshot matches, ack is removed.
    const first = applySignedAckAction(acksPath, {
      action: "close",
      file: "f",
      journey: "j",
      untilSnapshot: "2026-06-01",
      expiresAt: 0,
      nonce: "n",
    });
    expect(first.code).toBe("applied-close");

    // Someone re-creates the ack with a *different* `until`.
    writeAcks(acksPath, {
      acks: [{ file: "f", journey: "j", until: "2026-09-01" }],
    });

    // Replay the original close token. Snapshot disagrees with the
    // re-created ack's current `until`, so the replay must be rejected
    // and the re-created ack must remain intact.
    const replay = applySignedAckAction(acksPath, {
      action: "close",
      file: "f",
      journey: "j",
      untilSnapshot: "2026-06-01",
      expiresAt: 0,
      nonce: "n",
    });
    expect(replay.code).toBe("stale-snapshot");
    expect(readAcksRaw(acksPath).acks).toEqual([
      { file: "f", journey: "j", until: "2026-09-01" },
    ]);
  });

  it("closes an ack and is idempotent (second close is a friendly noop)", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcks(acksPath, {
      acks: [{ file: "f", journey: "j", until: "2026-06-01" }],
    });
    const first = applySignedAckAction(acksPath, {
      action: "close",
      file: "f",
      journey: "j",
      untilSnapshot: "2026-06-01",
      expiresAt: 0,
      nonce: "n",
    });
    expect(first.code).toBe("applied-close");
    expect(readAcksRaw(acksPath).acks).toEqual([]);
    const second = applySignedAckAction(acksPath, {
      action: "close",
      file: "f",
      journey: "j",
      untilSnapshot: "2026-06-01",
      expiresAt: 0,
      nonce: "n",
    });
    expect(second.code).toBe("noop-already-closed");
  });

  it("extending a missing ack returns ack-missing (does not create it)", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcks(acksPath, { acks: [] });
    const result = applySignedAckAction(acksPath, {
      action: "extend30",
      file: "f",
      journey: "j",
      untilSnapshot: "",
      expiresAt: 0,
      nonce: "n",
    });
    expect(result.code).toBe("ack-missing");
    expect(readAcksRaw(acksPath).acks).toEqual([]);
  });

  it("allows extending a never-expire ack (snapshot was empty)", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcks(acksPath, { acks: [{ file: "f", journey: "j" }] });
    const result = applySignedAckAction(
      acksPath,
      {
        action: "extend30",
        file: "f",
        journey: "j",
        untilSnapshot: "",
        expiresAt: 0,
        nonce: "n",
      },
      "2026-05-20",
    );
    expect(result.code).toBe("applied-extend");
    expect(result.newUntil).toBe("2026-06-19");
  });
});

describe("regression-ack --apply-token CLI", () => {
  it("end-to-end: sign a token, apply via CLI, ack expiry shifts", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcks(acksPath, {
      acks: [{ file: "e2e/x.spec.ts", journey: "j", until: "2026-06-01" }],
    });
    const secret = "shhh";
    const token = signAckActionToken({
      action: "extend7",
      file: "e2e/x.spec.ts",
      journey: "j",
      untilSnapshot: "2026-06-01",
      secret,
    });
    const proc = spawnSync(
      tsxBin,
      [ackScript, "--acks", acksPath, "--apply-token", token, "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, REGRESSION_ACK_SIGNING_SECRET: secret },
      },
    );
    expect(proc.status, `stderr: ${proc.stderr}`).toBe(0);
    const out = JSON.parse(proc.stdout);
    expect(out.ok).toBe(true);
    expect(out.code).toBe("applied-extend");
    expect(out.newUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const after = readAcksRaw(acksPath);
    expect(after.acks[0].until).toBe(out.newUntil);
  }, 60_000);

  it("fails cleanly when REGRESSION_ACK_SIGNING_SECRET is not set", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    fs.writeFileSync(acksPath, JSON.stringify({ acks: [] }));
    const env = { ...process.env };
    delete env.REGRESSION_ACK_SIGNING_SECRET;
    const proc = spawnSync(
      tsxBin,
      [ackScript, "--acks", acksPath, "--apply-token", "anything", "--json"],
      { encoding: "utf8", env },
    );
    expect(proc.status).toBe(2);
    expect(JSON.parse(proc.stdout)).toEqual({
      ok: false,
      reason: "secret-missing",
    });
  }, 60_000);

  it("rejects a token signed with a different secret", () => {
    const acksPath = path.join(tmpDir, "acks.json");
    writeAcks(acksPath, {
      acks: [{ file: "f", journey: "j", until: "2026-06-01" }],
    });
    const token = signAckActionToken({
      action: "close",
      file: "f",
      journey: "j",
      untilSnapshot: "2026-06-01",
      secret: "one",
    });
    const proc = spawnSync(
      tsxBin,
      [ackScript, "--acks", acksPath, "--apply-token", token, "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, REGRESSION_ACK_SIGNING_SECRET: "two" },
      },
    );
    expect(proc.status).toBe(1);
    const out = JSON.parse(proc.stdout);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("bad-signature");
  }, 60_000);
});
