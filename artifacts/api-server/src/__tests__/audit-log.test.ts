import { describe, it, expect } from "vitest";
import { fingerprintToken } from "../lib/audit-log";

describe("fingerprintToken", () => {
  it("returns the last 8 characters of a signed token", () => {
    const token = "eyJlIjoiYyIsImkiOjF9.abcdef123456789";
    expect(fingerprintToken(token)).toBe("23456789");
  });

  it("returns the whole string when shorter than 8 chars", () => {
    expect(fingerprintToken("abc")).toBe("abc");
  });

  it("never returns the full token for a realistic length", () => {
    const token = "a".repeat(120) + ".sig" + "b".repeat(40);
    const fp = fingerprintToken(token);
    expect(fp.length).toBe(8);
    expect(token.includes(fp)).toBe(true);
    expect(fp).not.toBe(token);
  });
});
