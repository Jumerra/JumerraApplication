import type { RequestHandler } from "express";

const SESSION_COOKIE_NAME = "talentlink.sid";

/**
 * Bridge `Authorization: Bearer <signed-cookie-value>` into a synthetic
 * `Cookie: talentlink.sid=<signed-cookie-value>` header BEFORE
 * `express-session` runs.  This lets browser contexts that cannot persist
 * our `Secure; SameSite=None; Partitioned` session cookie (e.g. third-
 * party-cookie-blocked tabs, deeply nested iframe previews on stricter
 * browsers, some privacy modes) keep working by attaching the session
 * token as a header from `localStorage` instead.
 *
 * The token IS the signed cookie value (`s:<sid>.<signature>`) returned
 * by `POST /auth/login` in its JSON body.  Express-session validates the
 * signature with SESSION_SECRET like normal, so this bridge never needs
 * to know the secret and adds no new trust surface beyond "the bearer of
 * the token is the session".
 *
 * The browser cookie path remains the primary mechanism — when a real
 * `talentlink.sid` cookie is present on the request we never override
 * it.  This is purely a fallback.
 */
export function sessionTokenBridge(): RequestHandler {
  return (req, _res, next) => {
    const auth = req.headers.authorization;
    if (!auth) return next();

    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) return next();
    const token = m[1].trim();
    if (!token) return next();

    // Reject anything that isn't a plausibly-shaped signed cookie value.
    // express-session signs cookies with cookie-signature, which produces
    // `s:<sid>.<base64-ish-sig>` — a small URL-safe alphabet.  Refuse
    // tokens containing cookie delimiters (";", ","), whitespace, or
    // control chars so we can never inject a second cookie or header.
    if (!/^s:[A-Za-z0-9_\-./=+]+$/.test(token)) {
      return next();
    }

    const existing = req.headers.cookie ?? "";
    const cookieRegex = new RegExp(
      `(?:^|;\\s*)${SESSION_COOKIE_NAME.replace(/\./g, "\\.")}=`,
    );
    if (cookieRegex.test(existing)) {
      // A real cookie is already present — let express-session use it.
      return next();
    }

    const synthetic = `${SESSION_COOKIE_NAME}=${token}`;
    req.headers.cookie = existing
      ? `${existing}; ${synthetic}`
      : synthetic;
    next();
  };
}
