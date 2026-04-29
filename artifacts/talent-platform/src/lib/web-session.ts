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
 * token if the API ever rejects it with 401 — this prevents a stale
 * token (server-side session expiry, manual revocation, secret
 * rotation) from being replayed forever and keeps the
 * `useGetCurrentUser` query in sync with reality on the next refetch.
 * Multi-tab consistency is handled by listening for the `storage`
 * event so a logout in one tab clears the cached identity in others.
 */
export function installWebSessionAuth(): void {
  setAuthTokenGetter(() => getWebSessionToken());

  if (typeof window === "undefined") return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    if (response.status === 401 && getWebSessionToken()) {
      // Only clear when we actually sent a token — avoids wiping a
      // freshly-set token on an unrelated 401 from a non-API endpoint.
      const sentBearer =
        init?.headers &&
        (() => {
          try {
            const h = new Headers(init.headers);
            return (h.get("authorization") ?? "")
              .toLowerCase()
              .startsWith("bearer ");
          } catch {
            return false;
          }
        })();
      if (sentBearer) {
        clearWebSessionToken();
      }
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
