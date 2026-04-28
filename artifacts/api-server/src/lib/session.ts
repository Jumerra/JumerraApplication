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

  return session({
    store,
    secret,
    name: "talentlink.sid",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // Auto-enable in production behind HTTPS; allow opt-out via env.
      secure: process.env.SESSION_COOKIE_SECURE
        ? process.env.SESSION_COOKIE_SECURE === "true"
        : process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}
