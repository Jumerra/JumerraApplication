import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import type { RequestHandler, Response } from "express";

const PgStore = connectPgSimple(session);

const SESSION_COOKIE_NAME = "talentlink.sid";

/**
 * Middleware that appends the `Partitioned` attribute to the session
 * cookie's `Set-Cookie` header.  This enables CHIPS (Cookies Having
 * Independent Partitioned State), which Chrome and other modern browsers
 * REQUIRE for cookies to be allowed in cross-site iframe contexts.
 *
 * This matters for the Replit workspace preview pane: the mobile app is
 * shown inside an iframe whose top-level site (the workspace) is on a
 * different origin than the API.  Without `Partitioned`, Chrome treats
 * the session cookie as a "third-party cookie" and silently blocks it
 * even though it has `SameSite=None; Secure`.  The user sees:
 *   1. POST /auth/login -> 200 with Set-Cookie (browser drops it)
 *   2. GET /auth/me     -> {user:null} (no cookie attached)
 *   3. AuthGate bounces them back to /sign-in (the "screen flashes"
 *      symptom).
 *
 * The `cookie` package used by express-session 1.19 supports the
 * `partitioned` option but express-session does not surface it, so we
 * patch the header on the way out.  See:
 *   https://developer.mozilla.org/en-US/docs/Web/Privacy/Privacy_sandbox/Partitioned_cookies
 */
function partitionedSessionCookieMiddleware(): RequestHandler {
  return (_req, res, next) => {
    const originalSetHeader = res.setHeader.bind(res) as Response["setHeader"];
    res.setHeader = function patchedSetHeader(
      name: string,
      value: number | string | readonly string[],
    ) {
      if (name.toLowerCase() === "set-cookie") {
        const arr = Array.isArray(value)
          ? value.map(String)
          : [String(value)];
        const patched = arr.map((cookie) =>
          cookie.startsWith(`${SESSION_COOKIE_NAME}=`) &&
          !/;\s*partitioned/i.test(cookie)
            ? `${cookie}; Partitioned`
            : cookie,
        );
        return originalSetHeader(name, patched as unknown as string[]);
      }
      return originalSetHeader(name, value);
    } as Response["setHeader"];
    next();
  };
}

export const sessionPartitionedCookiePatch = partitionedSessionCookieMiddleware;

export function buildSessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET env var is required");
  }

  const store = new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: true,
  });

  // The mobile app's Expo web preview is served from REPLIT_EXPO_DEV_DOMAIN
  // while the API is served from REPLIT_DEV_DOMAIN — those are different
  // hosts, so requests from the mobile preview to /api/* are cross-site
  // from the browser's perspective.  Modern browsers refuse to send
  // SameSite=Lax cookies on cross-site sub-requests, which means after a
  // successful POST /auth/login the session cookie was set but never
  // re-attached to the immediate GET /auth/me, so AuthGate saw no user
  // and bounced the candidate back to sign-in.  Switching to
  // `SameSite=None; Secure` makes the session cookie work in cross-site
  // contexts (the Replit dev/prod proxy already serves everything over
  // HTTPS, so `Secure=true` is safe in development too).  iOS/Android
  // native fetch in Expo Go also benefits because SameSite is irrelevant
  // there but it relies on the cookie being explicitly stored, and
  // having a consistent attribute set avoids surprises.
  const cookieSecureOverride = process.env.SESSION_COOKIE_SECURE;
  const secure =
    cookieSecureOverride !== undefined
      ? cookieSecureOverride === "true"
      : true;

  return session({
    store,
    secret,
    name: "talentlink.sid",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      // SameSite=None is required for cross-site cookies; per spec it
      // also REQUIRES Secure=true.  Both are kept aligned via the
      // `secure` value above.
      sameSite: "none",
      secure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}
