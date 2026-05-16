import { describe, expect, it, vi } from "vitest";

import {
  buildCancelUrl,
  buildSuccessUrl,
  buildWebOrigin,
  getDeepLinkPrefix,
  humanizeCheckoutError,
  parseCheckoutReturn,
} from "./checkout-urls";

const NATIVE_DOMAIN = "talent.example.com";
const NATIVE_ORIGIN = `https://${NATIVE_DOMAIN}`;
const NATIVE_DEEP_LINK = "talent-mobile://boost/return";
const EXP_DEEP_LINK = "exp://192.168.1.10:8081/--/boost/return";

describe("buildWebOrigin", () => {
  it("uses window.location.origin on web", () => {
    expect(
      buildWebOrigin({
        isWeb: true,
        windowOrigin: "https://example.com",
        envDomain: null,
      }),
    ).toBe("https://example.com");
  });

  it("throws on web when window origin is missing", () => {
    expect(() =>
      buildWebOrigin({ isWeb: true, windowOrigin: null }),
    ).toThrowError(/window\.location\.origin/);
  });

  it("uses EXPO_PUBLIC_DOMAIN on native", () => {
    expect(
      buildWebOrigin({ isWeb: false, envDomain: NATIVE_DOMAIN }),
    ).toBe(NATIVE_ORIGIN);
  });

  it("strips a leading scheme and trailing slashes from the env domain", () => {
    expect(
      buildWebOrigin({
        isWeb: false,
        envDomain: "https://talent.example.com//",
      }),
    ).toBe(NATIVE_ORIGIN);
    expect(
      buildWebOrigin({
        isWeb: false,
        envDomain: "http://talent.example.com",
      }),
    ).toBe(NATIVE_ORIGIN);
  });

  it("throws on native when EXPO_PUBLIC_DOMAIN is missing", () => {
    expect(() => buildWebOrigin({ isWeb: false, envDomain: null })).toThrowError(
      /EXPO_PUBLIC_DOMAIN/,
    );
  });
});

describe("buildSuccessUrl", () => {
  it("returns the bare success URL on web", () => {
    expect(
      buildSuccessUrl({
        suffix: "/boost/return",
        origin: "https://example.com",
        deepLink: null,
      }),
    ).toBe("https://example.com/boost/return?session_id={CHECKOUT_SESSION_ID}");
  });

  it("appends an encoded talent-mobile:// deep link on native", () => {
    expect(
      buildSuccessUrl({
        suffix: "/boost/return",
        origin: NATIVE_ORIGIN,
        deepLink: NATIVE_DEEP_LINK,
      }),
    ).toBe(
      `${NATIVE_ORIGIN}/boost/return?session_id={CHECKOUT_SESSION_ID}` +
        `&mobile_redirect=${encodeURIComponent(NATIVE_DEEP_LINK)}`,
    );
  });

  it("encodes exp:// fallback deep links from Expo Go", () => {
    const url = buildSuccessUrl({
      suffix: "/cv/return",
      origin: NATIVE_ORIGIN,
      deepLink: EXP_DEEP_LINK,
    });
    expect(url).toContain(
      `mobile_redirect=${encodeURIComponent(EXP_DEEP_LINK)}`,
    );
    expect(url).toContain("/cv/return?session_id={CHECKOUT_SESSION_ID}");
  });
});

describe("buildCancelUrl", () => {
  it("sends web users back to the candidate dashboard", () => {
    expect(
      buildCancelUrl({
        suffix: "/boost/return",
        origin: "https://example.com",
        deepLink: null,
      }),
    ).toBe("https://example.com/dashboard/candidate");
  });

  it("bounces native cancellations through the return page so the in-app browser closes", () => {
    expect(
      buildCancelUrl({
        suffix: "/boost/return",
        origin: NATIVE_ORIGIN,
        deepLink: NATIVE_DEEP_LINK,
      }),
    ).toBe(
      `${NATIVE_ORIGIN}/boost/return?cancelled=1` +
        `&mobile_redirect=${encodeURIComponent(NATIVE_DEEP_LINK)}`,
    );
  });

  it("uses the same flow for AI CV cancellations", () => {
    expect(
      buildCancelUrl({
        suffix: "/cv/return",
        origin: NATIVE_ORIGIN,
        deepLink: EXP_DEEP_LINK,
      }),
    ).toBe(
      `${NATIVE_ORIGIN}/cv/return?cancelled=1` +
        `&mobile_redirect=${encodeURIComponent(EXP_DEEP_LINK)}`,
    );
  });
});

describe("parseCheckoutReturn", () => {
  it("treats cancelled=1 as a cancellation regardless of session_id", () => {
    expect(
      parseCheckoutReturn({
        queryParams: { cancelled: "1", session_id: "cs_test_123" },
        fallbackSessionId: "cs_test_fallback",
      }),
    ).toEqual({ kind: "cancelled" });
  });

  it("returns the session id echoed back by Stripe when present", () => {
    expect(
      parseCheckoutReturn({
        queryParams: { session_id: "cs_test_from_url" },
        fallbackSessionId: "cs_test_fallback",
      }),
    ).toEqual({ kind: "success", sessionId: "cs_test_from_url" });
  });

  it("falls back to the createCheckout session id when the URL omits it", () => {
    expect(
      parseCheckoutReturn({
        queryParams: {},
        fallbackSessionId: "cs_test_fallback",
      }),
    ).toEqual({ kind: "success", sessionId: "cs_test_fallback" });
  });

  it("falls back when the URL has an empty session_id", () => {
    expect(
      parseCheckoutReturn({
        queryParams: { session_id: "" },
        fallbackSessionId: "cs_test_fallback",
      }),
    ).toEqual({ kind: "success", sessionId: "cs_test_fallback" });
  });

  it("handles array-shaped query params (Linking.parse can return string[])", () => {
    expect(
      parseCheckoutReturn({
        queryParams: { session_id: ["cs_test_first", "cs_test_second"] },
        fallbackSessionId: "cs_test_fallback",
      }),
    ).toEqual({ kind: "success", sessionId: "cs_test_first" });
  });

  it("treats null queryParams as a bare success that uses the fallback id", () => {
    expect(
      parseCheckoutReturn({
        queryParams: null,
        fallbackSessionId: "cs_test_fallback",
      }),
    ).toEqual({ kind: "success", sessionId: "cs_test_fallback" });
  });
});

describe("getDeepLinkPrefix", () => {
  it("returns null on web (no in-app browser to bounce back)", () => {
    const createUrl = vi.fn();
    expect(
      getDeepLinkPrefix({
        isWeb: true,
        suffix: "/boost/return",
        createUrl,
      }),
    ).toBeNull();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("strips a leading slash so we don't end up with talent-mobile:///boost/return", () => {
    const createUrl = vi.fn(
      (path: string) => `talent-mobile://${path}`,
    );
    expect(
      getDeepLinkPrefix({
        isWeb: false,
        suffix: "/boost/return",
        createUrl,
      }),
    ).toBe("talent-mobile://boost/return");
    expect(createUrl).toHaveBeenCalledWith("boost/return");
  });

  it("passes the path through unchanged when there's no leading slash", () => {
    const createUrl = vi.fn(
      (path: string) => `exp://192.168.1.10:8081/--/${path}`,
    );
    expect(
      getDeepLinkPrefix({
        isWeb: false,
        suffix: "cv/return",
        createUrl,
      }),
    ).toBe("exp://192.168.1.10:8081/--/cv/return");
    expect(createUrl).toHaveBeenCalledWith("cv/return");
  });
});

describe("humanizeCheckoutError", () => {
  it("strips the shared API client's HTTP status prefix", () => {
    const err = new Error("HTTP 400 Bad Request: boost is not active");
    expect(humanizeCheckoutError(err, "fallback")).toBe(
      "boost is not active",
    );
  });

  it("returns the original message when there is no status prefix", () => {
    const err = new Error("Network request failed");
    expect(humanizeCheckoutError(err, "fallback")).toBe(
      "Network request failed",
    );
  });

  it("falls back when given a non-Error", () => {
    expect(humanizeCheckoutError("oops", "fallback")).toBe("fallback");
    expect(humanizeCheckoutError(undefined, "fallback")).toBe("fallback");
  });

  it("falls back when stripping leaves an empty message", () => {
    const err = new Error("HTTP 500 Internal Server Error: ");
    expect(humanizeCheckoutError(err, "fallback")).toBe("fallback");
  });
});
