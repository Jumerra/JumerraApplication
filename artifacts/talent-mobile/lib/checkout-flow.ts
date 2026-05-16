// Platform-agnostic checkout orchestrator. Lives outside the React
// component so it can be exercised without mounting a screen and
// without an actual `WebBrowser`/`Linking` runtime — `profile.tsx`
// passes the real Expo implementations in, and tests pass mocks.

import {
  parseCheckoutReturn,
  type CheckoutReturnQuery,
} from "./checkout-urls";

export interface CheckoutCreateResult {
  checkoutUrl: string;
  sessionId: string;
}

export interface OpenAuthSessionResult {
  type: string;
  url?: string | null;
}

export interface ParsedDeepLink {
  queryParams: CheckoutReturnQuery;
}

export interface RunMobileCheckoutInput {
  successUrl: string;
  cancelUrl: string;
  /** The deep link `WebBrowser.openAuthSessionAsync` should bounce back to. */
  deepLink: string;
  createCheckout: (urls: {
    successUrl: string;
    cancelUrl: string;
  }) => Promise<CheckoutCreateResult>;
  openAuthSession: (
    checkoutUrl: string,
    deepLink: string,
  ) => Promise<OpenAuthSessionResult>;
  parseReturnUrl: (url: string) => ParsedDeepLink;
  verify: (sessionId: string) => Promise<void>;
  /**
   * Called after `verify` resolves on a successful return. The
   * profile screen uses this to invalidate the candidate / boost /
   * CV query caches so the freshly-purchased state shows up
   * immediately. Wired here (rather than left to the caller after
   * the function resolves) so tests can prove the invalidation fires
   * exclusively on the success branch.
   */
  onVerified?: (sessionId: string) => Promise<void> | void;
}

export type RunMobileCheckoutResult =
  /** Verify succeeded — caller should refresh caches. */
  | { status: "success"; sessionId: string }
  /** Stripe sent us back via the cancel URL. */
  | { status: "cancelled" }
  /** User dismissed the in-app browser before reaching either URL. */
  | { status: "dismissed" };

/**
 * Drives the mobile-side half of the Stripe checkout round trip:
 * create the session, hand off to the in-app browser, and on a
 * successful return parse the session id back out and call `verify`.
 *
 * Errors from `createCheckout` or `verify` propagate to the caller so
 * the UI can surface them via the existing alert path.
 */
export async function runMobileCheckoutFlow(
  input: RunMobileCheckoutInput,
): Promise<RunMobileCheckoutResult> {
  const { checkoutUrl, sessionId } = await input.createCheckout({
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
  const browserResult = await input.openAuthSession(
    checkoutUrl,
    input.deepLink,
  );
  if (browserResult.type !== "success" || !browserResult.url) {
    // `openAuthSessionAsync` returns `dismiss`/`cancel`/etc. when the
    // user closes the sheet without us hitting either return URL.
    return { status: "dismissed" };
  }
  const parsed = input.parseReturnUrl(browserResult.url);
  const outcome = parseCheckoutReturn({
    queryParams: parsed.queryParams,
    fallbackSessionId: sessionId,
  });
  if (outcome.kind === "cancelled") {
    return { status: "cancelled" };
  }
  await input.verify(outcome.sessionId);
  if (input.onVerified) {
    await input.onVerified(outcome.sessionId);
  }
  return { status: "success", sessionId: outcome.sessionId };
}
