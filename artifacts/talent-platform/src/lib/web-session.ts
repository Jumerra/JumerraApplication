import { setAuthTokenGetter } from "@workspace/api-client-react";

/**
 * localStorage-backed fallback for the session cookie.
 *
 * The API normally authenticates via a `Secure; SameSite=None;
 * Partitioned` cookie.  In some browser contexts — most notably the
 * Replit workspace's nested iframe preview, and any browser/profile
 * that aggressively blocks third-party cookies — that cookie cannot be
 * persisted, so the next request after `POST /auth/login` arrives
 * unauthenticated and the admin console renders the "Admin access
 * required" gate.
 *
 * To work around it, the login response also returns a signed
 * `sessionToken` (the same value the cookie would carry).  We persist
 * it here and replay it as `Authorization: Bearer <token>` on every
 * request via `setAuthTokenGetter`; a dedicated bridge middleware on
 * the API server turns that header back into a session cookie before
 * `express-session` runs.  The browser cookie still flows in parallel
 * whenever the browser allows it — the token is purely a fallback.
 */
const STORAGE_KEY = "talentlink_session_token";

// Timestamp (ms since epoch) of the most recent setWebSessionToken
// call.  Used by the auto-clear logic in installWebSessionAuth to
// avoid wiping a freshly-installed token in response to a stale 401
// from a request that was already in flight when the user logged in.
let lastSetAt = 0;

// Grace window (ms): suppress 401-driven token clears for this long
// after a fresh token is set.  This covers the realistic worst case
// where 1) a query was fired from a previous-user dashboard a moment
// before logout/login, 2) the server has destroyed the prior session,
// 3) the response (401) lands AFTER the new login response, and our
// wrapper would otherwise mistake it for a "current token is bad" signal.
const FRESH_GRACE_MS = 5_000;

export function getWebSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setWebSessionToken(token: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (token && typeof token === "string") {
      window.localStorage.setItem(STORAGE_KEY, token);
      lastSetAt = Date.now();
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Best-effort: storage may be disabled (private mode, quota, etc).
  }
}

export function clearWebSessionToken(): void {
  setWebSessionToken(null);
}

/**
 * Install the bearer-token getter exactly once at app boot.  Safe to
 * call from `main.tsx` before React renders.
 *
 * Also installs a global `fetch` wrapper that drops the persisted
 * token when the canonical session probe (`GET /api/auth/me`)
 * confirms the session is dead — this prevents a stale token from
 * being replayed forever and keeps the `useGetCurrentUser` query in
 * sync with reality on the next refetch.
 *
 * IMPORTANT: We deliberately scope the auto-clear to `/auth/me`
 * responses (and only when the response body says `user: null`)
 * rather than reacting to any 401.  Many endpoints can legitimately
 * return 401 for reasons unrelated to session validity (a stale
 * background refetch arriving after logout, a permission-restricted
 * endpoint, an in-flight request straddling a re-login, etc.) and
 * blowing away the token in those cases produced an "access required"
 * loop where every fresh login was wiped within milliseconds.
 *
 * Multi-tab consistency is handled by listening for the `storage`
 * event so a logout in one tab clears the cached identity in others.
 */
export function installWebSessionAuth(): void {
  setAuthTokenGetter(() => getWebSessionToken());

  if (typeof window === "undefined") return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);

    // Only consider clearing the token when we have one to clear and
    // when the response actually came from our own auth probe.  Don't
    // touch the token for any other 401 — those are routinely caused
    // by races between logout/login and in-flight queries.
    if (!getWebSessionToken()) return response;
    if (Date.now() - lastSetAt < FRESH_GRACE_MS) return response;

    // Resolve the URL of the request safely across the (string |
    // URL | Request) input shapes that fetch accepts.
    let url = "";
    try {
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = input.toString();
      else if (typeof Request !== "undefined" && input instanceof Request)
        url = input.url;
    } catch {
      // Best-effort.
    }

    if (!url.includes("/api/auth/me")) return response;
    if (!response.ok) return response;

    // Inspect a clone so the original response stream remains intact
    // for the caller's parser.
    try {
      const clone = response.clone();
      const ct = clone.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = (await clone.json()) as { user?: unknown } | null;
        if (body && body.user === null) {
          clearWebSessionToken();
        }
      }
    } catch {
      // If parsing fails, leave the token alone — better to leave a
      // stale token in place than to surprise the user with a logout.
    }

    return response;
  };

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue === null) {
      // Another tab logged out — nothing to do here besides letting
      // the next API call notice the missing token; React Query will
      // refetch and the layout will redirect on null user.
    }
  });
}
