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

describe("selectPaymentRail (Ghana-first: Stripe disabled)", () => {
  it("always returns paystack for African currencies", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_xxx";
    expect(selectPaymentRail({ currency: "GHS" })).toBe("paystack");
    expect(selectPaymentRail({ currency: "NGN" })).toBe("paystack");
    expect(selectPaymentRail({ currency: "kes" })).toBe("paystack");
  });

  it("always returns paystack for non-African currencies too", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_xxx";
    expect(selectPaymentRail({ currency: "USD" })).toBe("paystack");
    expect(selectPaymentRail({ currency: "EUR" })).toBe("paystack");
    expect(selectPaymentRail({ currency: "GBP" })).toBe("paystack");
  });

  it("ignores any stripe override", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_xxx";
    expect(
      selectPaymentRail({ currency: "USD", override: "stripe" }),
    ).toBe("paystack");
    expect(
      selectPaymentRail({ currency: "GHS", override: "stripe" }),
    ).toBe("paystack");
  });

  it("still returns paystack even if the secret is missing (configuration error surfaces at checkout)", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(selectPaymentRail({ currency: "GHS" })).toBe("paystack");
  });
});
