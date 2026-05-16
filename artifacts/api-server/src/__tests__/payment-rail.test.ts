import { describe, it, expect, afterEach } from "vitest";
import {
  isPaystackCurrency,
  selectPaymentRail,
} from "../lib/payment-rail";

const originalSecret = process.env.PAYSTACK_SECRET_KEY;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.PAYSTACK_SECRET_KEY;
  } else {
    process.env.PAYSTACK_SECRET_KEY = originalSecret;
  }
});

describe("isPaystackCurrency", () => {
  it("recognises the four native African currencies", () => {
    expect(isPaystackCurrency("NGN")).toBe(true);
    expect(isPaystackCurrency("ghs")).toBe(true);
    expect(isPaystackCurrency("ZAR")).toBe(true);
    expect(isPaystackCurrency("kes")).toBe(true);
  });

  it("returns false for everything else", () => {
    expect(isPaystackCurrency("USD")).toBe(false);
    expect(isPaystackCurrency("EUR")).toBe(false);
    expect(isPaystackCurrency("GBP")).toBe(false);
  });
});

describe("selectPaymentRail", () => {
  it("routes African currencies to Paystack when configured", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_xxx";
    expect(selectPaymentRail({ currency: "NGN" })).toBe("paystack");
    expect(selectPaymentRail({ currency: "ghs" })).toBe("paystack");
  });

  it("falls back to Stripe when Paystack is not configured", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(selectPaymentRail({ currency: "NGN" })).toBe("stripe");
  });

  it("routes non-African currencies to Stripe even when Paystack is up", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_xxx";
    expect(selectPaymentRail({ currency: "USD" })).toBe("stripe");
    expect(selectPaymentRail({ currency: "EUR" })).toBe("stripe");
  });

  it("honors an explicit override", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_xxx";
    expect(
      selectPaymentRail({ currency: "USD", override: "paystack" }),
    ).toBe("paystack");
    expect(
      selectPaymentRail({ currency: "NGN", override: "stripe" }),
    ).toBe("stripe");
  });

  it("downgrades a paystack override to stripe when paystack is not configured", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(
      selectPaymentRail({ currency: "USD", override: "paystack" }),
    ).toBe("stripe");
  });
});
