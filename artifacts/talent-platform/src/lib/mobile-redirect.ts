// Only allow bouncing back to the mobile app via known native-app
// deep-link schemes. This blocks open-redirect / javascript: / data:
// abuse via a crafted ?mobile_redirect= query param on web return
// pages that the mobile checkout flow uses to hand control back to
// the native app.
const MOBILE_REDIRECT_SCHEMES = new Set([
  "talent-mobile:",
  "exp:",
  "exps:",
]);

export function sanitizeMobileRedirect(raw: string | null): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!MOBILE_REDIRECT_SCHEMES.has(parsed.protocol)) return null;
  return raw;
}
