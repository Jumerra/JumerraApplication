// Pure helpers backing the in-app Stripe checkout flow on the profile
// screen. They are intentionally free of `Platform`, `expo-linking`, and
// `expo-web-browser` so they can be unit-tested without a React Native
// runtime — `runMobileCheckoutFlow` and the calling component are
// responsible for resolving the platform-specific bits and passing them
// in here.

export interface BuildWebOriginInput {
  isWeb: boolean;
  /** `window.location.origin` when running on web, otherwise ignored. */
  windowOrigin?: string | null;
  /** `EXPO_PUBLIC_DOMAIN` value when running on native. */
  envDomain?: string | null;
}

export function buildWebOrigin(input: BuildWebOriginInput): string {
  if (input.isWeb) {
    if (!input.windowOrigin) {
      throw new Error("window.location.origin is unavailable on web.");
    }
    return input.windowOrigin;
  }
  const raw = input.envDomain;
  if (!raw) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not configured. Cannot start checkout.",
    );
  }
  // Tolerate misconfigured env values like "https://example.com" or
  // trailing slashes — the rest of the app expects a bare host.
  const domain = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${domain}`;
}

export interface BuildReturnUrlInput {
  /** Web return path, e.g. `/boost/return` or `/cv/return`. */
  suffix: string;
  origin: string;
  /**
   * Native deep-link prefix that the web bounce page should redirect
   * back into. `null` on web — we never bounce there, we just navigate.
   */
  deepLink: string | null;
}

export function buildSuccessUrl(input: BuildReturnUrlInput): string {
  const base = `${input.origin}${input.suffix}?session_id={CHECKOUT_SESSION_ID}`;
  if (!input.deepLink) return base;
  return `${base}&mobile_redirect=${encodeURIComponent(input.deepLink)}`;
}

export function buildCancelUrl(input: BuildReturnUrlInput): string {
  if (!input.deepLink) {
    // On web there is no in-app browser to dismiss, so we just bring
    // the user back to their dashboard.
    return `${input.origin}/dashboard/candidate`;
  }
  return `${input.origin}${input.suffix}?cancelled=1&mobile_redirect=${encodeURIComponent(input.deepLink)}`;
}

/**
 * Subset of what `Linking.parse(url).queryParams` returns — values may
 * be strings, arrays of strings, or missing entirely. We only ever
 * care about the first string for our keys.
 */
export type CheckoutReturnQuery = Record<
  string,
  string | string[] | undefined | null
> | null;

export type CheckoutReturnOutcome =
  | { kind: "cancelled" }
  | { kind: "success"; sessionId: string };

export interface ParseCheckoutReturnInput {
  queryParams: CheckoutReturnQuery;
  /**
   * The session id we received from `createCheckout`, used as a
   * fallback when the deep-link itself didn't echo it back (e.g. some
   * bounces strip the `{CHECKOUT_SESSION_ID}` placeholder if the user
   * never reached the success URL).
   */
  fallbackSessionId: string;
}

function pickFirst(
  value: string | string[] | undefined | null,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value;
  return undefined;
}

export function parseCheckoutReturn(
  input: ParseCheckoutReturnInput,
): CheckoutReturnOutcome {
  const params = input.queryParams ?? {};
  if (pickFirst(params.cancelled) === "1") {
    return { kind: "cancelled" };
  }
  const fromUrl = pickFirst(params.session_id);
  const sessionId =
    fromUrl && fromUrl.length > 0 ? fromUrl : input.fallbackSessionId;
  return { kind: "success", sessionId };
}

/**
 * Strip the "HTTP 400 Bad Request: " prefix added by our shared API
 * client so the alert shows the actual server message rather than a
 * raw status line.
 */
export function humanizeCheckoutError(
  err: unknown,
  fallback: string,
): string {
  if (!(err instanceof Error)) return fallback;
  return err.message.replace(/^HTTP \d+ [^:]+: /, "") || fallback;
}

export interface DeepLinkPrefixInput {
  isWeb: boolean;
  /** The path the deep link should resolve to, e.g. `/boost/return`. */
  suffix: string;
  /**
   * Native `Linking.createURL` (or test fake). Receives the suffix
   * with any leading slash removed so the resulting URL is a clean
   * deep link rather than `talent-mobile:///boost/return`.
   */
  createUrl: (path: string) => string;
}

/**
 * On native, return the deep-link URL the in-app browser should hand
 * back to the app. On web, return `null` — there is no in-app browser
 * to bounce back, we just navigate.
 */
export function getDeepLinkPrefix(input: DeepLinkPrefixInput): string | null {
  if (input.isWeb) return null;
  return input.createUrl(input.suffix.replace(/^\//, ""));
}
