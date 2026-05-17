/**
 * Boot-time environment validator. Exits with a non-zero status code
 * (and a human-readable error) if a required secret is missing in
 * production — much friendlier than a stack trace on first request.
 *
 * The full set of variables Jumerra recognises (with semantics) is
 * documented in `replit.md`.
 */

import { logger } from "./logger";

interface RequiredVar {
  key: string;
  reason: string;
}

/** Hard requirements in production. Missing any of these is fatal. */
const PROD_REQUIRED: RequiredVar[] = [
  { key: "DATABASE_URL", reason: "PostgreSQL connection string" },
  { key: "SESSION_SECRET", reason: "express-session secret" },
];

/** Soft warnings — the server still boots but the feature won't work. */
const PROD_RECOMMENDED: RequiredVar[] = [
  { key: "RESEND_API_KEY", reason: "transactional email delivery" },
  { key: "EMAIL_DEFAULT_FROM", reason: "From: address for outgoing email" },
  { key: "STRIPE_SECRET_KEY", reason: "Stripe payments" },
  { key: "STRIPE_WEBHOOK_SECRET", reason: "Stripe webhook signature verification" },
  { key: "PAYSTACK_SECRET_KEY", reason: "Paystack payments (Africa-first rail)" },
  { key: "SENTRY_DSN_SERVER", reason: "server-side error tracking" },
  {
    key: "DEFAULT_OBJECT_STORAGE_BUCKET_ID",
    reason: "object storage (avatars, CVs)",
  },
  {
    key: "TRASH_RETENTION_DAYS",
    reason: "trash auto-purge window in days (default 30)",
  },
];

export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === "production";
  const missingRequired: RequiredVar[] = [];
  const missingRecommended: RequiredVar[] = [];

  for (const v of PROD_REQUIRED) {
    if (!process.env[v.key]) missingRequired.push(v);
  }
  for (const v of PROD_RECOMMENDED) {
    if (!process.env[v.key]) missingRecommended.push(v);
  }

  if (missingRequired.length > 0) {
    const summary = missingRequired
      .map((v) => `  - ${v.key}: ${v.reason}`)
      .join("\n");
    if (isProd) {
      // eslint-disable-next-line no-console
      console.error(
        `\nFATAL: required environment variables are missing in production:\n${summary}\n\n` +
          `Set them via the Replit Secrets tab (or your deployment provider) and redeploy.\n`,
      );
      process.exit(1);
    } else {
      logger.warn(
        { missing: missingRequired.map((v) => v.key) },
        "env-validator: required env vars missing (non-prod — continuing)",
      );
    }
  }

  if (missingRecommended.length > 0) {
    logger.warn(
      { missing: missingRecommended.map((v) => v.key), env: process.env.NODE_ENV },
      "env-validator: optional env vars missing — related features will be disabled",
    );
  } else {
    logger.info({ env: process.env.NODE_ENV }, "env-validator: all known vars present");
  }
}
