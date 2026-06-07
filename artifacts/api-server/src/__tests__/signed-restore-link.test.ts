import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createRestoreToken,
  verifyRestoreToken,
  buildRestoreUrl,
} from "../lib/signed-restore-link";

const ORIGINAL_SECRET = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "unit-test-secret-please-do-not-use-in-prod";
});
afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ORIGINAL_SECRET;
});

describe("signed restore link", () => {
  it("round-trips a valid token including the deletedAt nonce", () => {
    const exp = Date.now() + 60_000;
    const deletedAt = Date.now() - 1_000;
    const token = createRestoreToken({
      entity: "candidate",
      id: 42,
      expiresAtMs: exp,
      deletedAtMs: deletedAt,
    });
    const v = verifyRestoreToken(token);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.entity).toBe("candidate");
      expect(v.id).toBe(42);
      expect(v.expiresAtMs).toBe(Math.floor(exp));
      expect(v.deletedAtMs).toBe(Math.floor(deletedAt));
    }
  });

  it("rejects an expired token", () => {
    const token = createRestoreToken({
      entity: "employer",
      id: 7,
      expiresAtMs: Date.now() - 1_000,
      deletedAtMs: Date.now() - 10_000,
    });
    const v = verifyRestoreToken(token);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("expired");
  });

  it("rejects a tampered payload without re-signing", () => {
    const exp = Date.now() + 60_000;
    const token = createRestoreToken({
      entity: "institution",
      id: 1,
      expiresAtMs: exp,
      deletedAtMs: 1,
    });
    const [payload, sig] = token.split(".");
    const forged = `${payload!.replace(/.$/, "X")}.${sig}`;
    const v = verifyRestoreToken(forged);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("bad_signature");
  });

  it("rejects a token signed with a different secret", () => {
    const token = createRestoreToken({
      entity: "candidate",
      id: 5,
      expiresAtMs: Date.now() + 60_000,
      deletedAtMs: 1,
    });
    process.env.SESSION_SECRET = "different-secret";
    const v = verifyRestoreToken(token);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("bad_signature");
  });

  it("rejects malformed tokens", () => {
    expect(verifyRestoreToken("not-a-token").ok).toBe(false);
    expect(verifyRestoreToken("").ok).toBe(false);
    expect(verifyRestoreToken("a.b.c").ok).toBe(false);
    expect(verifyRestoreToken(".sig").ok).toBe(false);
  });

  it("rejects a sig of different length without throwing (constant-time guard)", () => {
    const exp = Date.now() + 60_000;
    const token = createRestoreToken({
      entity: "job",
      id: 9,
      expiresAtMs: exp,
      deletedAtMs: 1,
    });
    const [payload] = token.split(".");
    expect(() => verifyRestoreToken(`${payload}.short`)).not.toThrow();
    const v = verifyRestoreToken(`${payload}.short`);
    expect(v.ok).toBe(false);
  });

  it("rejects an old-format token missing the deletedAt nonce (malformed)", () => {
    // Hand-craft a token shaped like the pre-single-use format
    // {e,i,x} with no `d`. It must be rejected as malformed so old
    // links can never bypass the consumption check.
    const payload = Buffer.from(JSON.stringify({ e: "c", i: 1, x: Date.now() + 60_000 }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    // Sign it correctly so the only failing check is the missing `d`.
    const sig = crypto
      .createHmac("sha256", process.env.SESSION_SECRET!)
      .update(payload)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const v = verifyRestoreToken(`${payload}.${sig}`);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("malformed");
  });

  it("buildRestoreUrl produces an absolute, token-bearing URL with the nonce", () => {
    const url = buildRestoreUrl({
      origin: "https://example.com/",
      entity: "candidate",
      id: 123,
      expiresAtMs: Date.now() + 60_000,
      deletedAtMs: 1700000000000,
    });
    expect(url.startsWith("https://example.com/api/admin/trash/restore?token=")).toBe(true);
    const token = decodeURIComponent(url.split("token=")[1]!);
    expect(token).not.toMatch(/[+/=]/);
    const v = verifyRestoreToken(token);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.entity).toBe("candidate");
      expect(v.id).toBe(123);
      expect(v.deletedAtMs).toBe(1700000000000);
    }
  });

  it("two warning emails for the same row produce different tokens after a re-delete cycle", () => {
    // First delete cycle.
    const firstDeletedAt = 1700000000000;
    const exp = Date.now() + 60_000;
    const tokenA = createRestoreToken({
      entity: "candidate",
      id: 42,
      expiresAtMs: exp,
      deletedAtMs: firstDeletedAt,
    });
    // After restore + re-delete the deletedAt is a new value.
    const secondDeletedAt = 1700000050000;
    const tokenB = createRestoreToken({
      entity: "candidate",
      id: 42,
      expiresAtMs: exp,
      deletedAtMs: secondDeletedAt,
    });
    expect(tokenA).not.toBe(tokenB);
    const a = verifyRestoreToken(tokenA);
    const b = verifyRestoreToken(tokenB);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.deletedAtMs).toBe(firstDeletedAt);
      expect(b.deletedAtMs).toBe(secondDeletedAt);
    }
  });
});
