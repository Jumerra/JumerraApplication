import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import type { RequestHandler } from "express";

const PgStore = connectPgSimple(session);

export function buildSessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET env var is required");
  }

  const store = new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: false,
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
