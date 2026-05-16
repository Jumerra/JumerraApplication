import { describe, expect, it, vi, type Mock } from "vitest";

import {
  runMobileCheckoutFlow,
  type CheckoutCreateResult,
  type OpenAuthSessionResult,
  type ParsedDeepLink,
  type RunMobileCheckoutInput,
} from "./checkout-flow";

const NATIVE_ORIGIN = "https://talent.example.com";
const BOOST_DEEP_LINK = "talent-mobile://boost/return";
const CV_DEEP_LINK = "talent-mobile://cv/return";

interface FlowDeps extends RunMobileCheckoutInput {
  createCheckout: Mock<
    (urls: { successUrl: string; cancelUrl: string }) => Promise<CheckoutCreateResult>
  >;
  openAuthSession: Mock<
    (checkoutUrl: string, deepLink: string) => Promise<OpenAuthSessionResult>
  >;
  parseReturnUrl: Mock<(url: string) => ParsedDeepLink>;
  verify: Mock<(sessionId: string) => Promise<void>>;
  onVerified: Mock<(sessionId: string) => Promise<void>>;
}

function makeFlow({
  suffix,
  deepLink,
  browserResult,
  parsedReturn,
  checkoutSessionId = "cs_test_from_create",
  verifyImpl,
}: {
  suffix: "/boost/return" | "/cv/return";
  deepLink: string;
  browserResult: OpenAuthSessionResult;
  parsedReturn?: ParsedDeepLink;
  checkoutSessionId?: string;
  verifyImpl?: () => Promise<void>;
}): FlowDeps {
  const successUrl = `${NATIVE_ORIGIN}${suffix}?session_id={CHECKOUT_SESSION_ID}&mobile_redirect=${encodeURIComponent(deepLink)}`;
  const cancelUrl = `${NATIVE_ORIGIN}${suffix}?cancelled=1&mobile_redirect=${encodeURIComponent(deepLink)}`;
  return {
    successUrl,
    cancelUrl,
    deepLink,
    createCheckout: vi.fn(async () => ({
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_from_create",
      sessionId: checkoutSessionId,
    })),
    openAuthSession: vi.fn(async () => browserResult),
    parseReturnUrl: vi.fn(
      () => parsedReturn ?? { queryParams: null },
    ),
    verify: vi.fn(verifyImpl ?? (async () => {})),
    onVerified: vi.fn(async () => {}),
  };
}

describe("runMobileCheckoutFlow", () => {
  it("verifies with the deep-linked session id when Stripe echoes one back (boost)", async () => {
    const deps = makeFlow({
      suffix: "/boost/return",
      deepLink: BOOST_DEEP_LINK,
      browserResult: {
        type: "success",
        url: `${BOOST_DEEP_LINK}?session_id=cs_test_real_boost`,
      },
      parsedReturn: {
        queryParams: { session_id: "cs_test_real_boost" },
      },
    });

    const result = await runMobileCheckoutFlow(deps);

    expect(result).toEqual({
      status: "success",
      sessionId: "cs_test_real_boost",
    });
    expect(deps.createCheckout).toHaveBeenCalledTimes(1);
    expect(deps.createCheckout).toHaveBeenCalledWith({
      successUrl: deps.successUrl,
      cancelUrl: deps.cancelUrl,
    });
    expect(deps.openAuthSession).toHaveBeenCalledTimes(1);
    expect(deps.openAuthSession).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/pay/cs_test_from_create",
      BOOST_DEEP_LINK,
    );
    expect(deps.verify).toHaveBeenCalledTimes(1);
    expect(deps.verify).toHaveBeenCalledWith("cs_test_real_boost");
    // Cache invalidation should fire with the same id verify saw — this
    // is the regression that would otherwise only show up on a real
    // device after Stripe bounces the user back to the app.
    expect(deps.onVerified).toHaveBeenCalledTimes(1);
    expect(deps.onVerified).toHaveBeenCalledWith("cs_test_real_boost");
    expect(deps.onVerified.mock.invocationCallOrder[0]).toBeGreaterThan(
      deps.verify.mock.invocationCallOrder[0],
    );
  });

  it("verifies with the deep-linked session id for AI CV checkouts too", async () => {
    const deps = makeFlow({
      suffix: "/cv/return",
      deepLink: CV_DEEP_LINK,
      browserResult: {
        type: "success",
        url: `${CV_DEEP_LINK}?session_id=cs_test_real_cv`,
      },
      parsedReturn: {
        queryParams: { session_id: "cs_test_real_cv" },
      },
    });

    const result = await runMobileCheckoutFlow(deps);

    expect(result).toEqual({
      status: "success",
      sessionId: "cs_test_real_cv",
    });
    expect(deps.verify).toHaveBeenCalledWith("cs_test_real_cv");
    expect(deps.onVerified).toHaveBeenCalledWith("cs_test_real_cv");
  });

  it("falls back to the createCheckout session id when the deep link omits it", async () => {
    const deps = makeFlow({
      suffix: "/boost/return",
      deepLink: BOOST_DEEP_LINK,
      browserResult: { type: "success", url: BOOST_DEEP_LINK },
      parsedReturn: { queryParams: {} },
      checkoutSessionId: "cs_test_fallback_boost",
    });

    const result = await runMobileCheckoutFlow(deps);

    expect(result).toEqual({
      status: "success",
      sessionId: "cs_test_fallback_boost",
    });
    expect(deps.verify).toHaveBeenCalledWith("cs_test_fallback_boost");
    expect(deps.onVerified).toHaveBeenCalledWith("cs_test_fallback_boost");
  });

  it("returns 'cancelled' and skips verify (and the cache refresh) when the bounce flags cancelled=1", async () => {
    const deps = makeFlow({
      suffix: "/boost/return",
      deepLink: BOOST_DEEP_LINK,
      browserResult: {
        type: "success",
        url: `${BOOST_DEEP_LINK}?cancelled=1`,
      },
      parsedReturn: { queryParams: { cancelled: "1" } },
    });

    const result = await runMobileCheckoutFlow(deps);

    expect(result).toEqual({ status: "cancelled" });
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.onVerified).not.toHaveBeenCalled();
  });

  it("returns 'dismissed' when the user closes the in-app browser early", async () => {
    const deps = makeFlow({
      suffix: "/cv/return",
      deepLink: CV_DEEP_LINK,
      browserResult: { type: "dismiss" },
    });

    const result = await runMobileCheckoutFlow(deps);

    expect(result).toEqual({ status: "dismissed" });
    expect(deps.parseReturnUrl).not.toHaveBeenCalled();
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.onVerified).not.toHaveBeenCalled();
  });

  it("treats a 'success' type without a url as a dismissal (defensive)", async () => {
    const deps = makeFlow({
      suffix: "/boost/return",
      deepLink: BOOST_DEEP_LINK,
      browserResult: { type: "success", url: null },
    });

    const result = await runMobileCheckoutFlow(deps);

    expect(result).toEqual({ status: "dismissed" });
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.onVerified).not.toHaveBeenCalled();
  });

  it("does not call onVerified if verify rejects (the cache shouldn't be marked fresh)", async () => {
    const deps = makeFlow({
      suffix: "/boost/return",
      deepLink: BOOST_DEEP_LINK,
      browserResult: {
        type: "success",
        url: `${BOOST_DEEP_LINK}?session_id=cs_test_real_boost`,
      },
      parsedReturn: { queryParams: { session_id: "cs_test_real_boost" } },
      verifyImpl: async () => {
        throw new Error("HTTP 502 Bad Gateway: stripe outage");
      },
    });

    await expect(runMobileCheckoutFlow(deps)).rejects.toThrow(
      "HTTP 502 Bad Gateway: stripe outage",
    );
    expect(deps.onVerified).not.toHaveBeenCalled();
  });

  it("propagates errors from createCheckout so the caller can surface the API message", async () => {
    const deps = makeFlow({
      suffix: "/boost/return",
      deepLink: BOOST_DEEP_LINK,
      browserResult: { type: "success", url: BOOST_DEEP_LINK },
    });
    deps.createCheckout.mockRejectedValueOnce(
      new Error("HTTP 400 Bad Request: boost is not active"),
    );

    await expect(runMobileCheckoutFlow(deps)).rejects.toThrow(
      "HTTP 400 Bad Request: boost is not active",
    );
    expect(deps.openAuthSession).not.toHaveBeenCalled();
  });

  it("propagates errors from verify so the caller can surface them", async () => {
    const deps = makeFlow({
      suffix: "/cv/return",
      deepLink: CV_DEEP_LINK,
      browserResult: {
        type: "success",
        url: `${CV_DEEP_LINK}?session_id=cs_test_real_cv`,
      },
      parsedReturn: { queryParams: { session_id: "cs_test_real_cv" } },
      verifyImpl: async () => {
        throw new Error("HTTP 502 Bad Gateway: stripe outage");
      },
    });

    await expect(runMobileCheckoutFlow(deps)).rejects.toThrow(
      "HTTP 502 Bad Gateway: stripe outage",
    );
  });
});
