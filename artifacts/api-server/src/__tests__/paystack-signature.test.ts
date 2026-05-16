import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import { verifyPaystackSignature } from "../paystackClient";

const SECRET = "sk_test_paystack_signature_unit";
const originalSecret = process.env.PAYSTACK_SECRET_KEY;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.PAYSTACK_SECRET_KEY;
  } else {
    process.env.PAYSTACK_SECRET_KEY = originalSecret;
  }
});

function sign(body: Buffer, secret = SECRET): string {
  return crypto.createHmac("sha512", secret).update(body).digest("hex");
}

describe("verifyPaystackSignature", () => {
  it("returns true for a valid HMAC-SHA512 of the raw body", () => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    const body = Buffer.from(JSON.stringify({ event: "charge.success" }));
    expect(verifyPaystackSignature(body, sign(body))).toBe(true);
  });

  it("returns false when the signature does not match", () => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    const body = Buffer.from(JSON.stringify({ event: "charge.success" }));
    const bad = "0".repeat(128);
    expect(verifyPaystackSignature(body, bad)).toBe(false);
  });

  it("returns false when the signature was made with the wrong secret", () => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    const body = Buffer.from(JSON.stringify({ event: "charge.success" }));
    expect(
      verifyPaystackSignature(body, sign(body, "wrong_secret")),
    ).toBe(false);
  });

  it("returns false when the header is missing", () => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    const body = Buffer.from("{}");
    expect(verifyPaystackSignature(body, undefined)).toBe(false);
    expect(verifyPaystackSignature(body, "")).toBe(false);
  });

  it("returns false when no secret is configured", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const body = Buffer.from("{}");
    expect(verifyPaystackSignature(body, "anything")).toBe(false);
  });

  it("uses constant-time comparison (no length-based early return crash)", () => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    const body = Buffer.from("{}");
    // shorter than expected — must return false, not throw.
    expect(verifyPaystackSignature(body, "abc")).toBe(false);
  });
});
