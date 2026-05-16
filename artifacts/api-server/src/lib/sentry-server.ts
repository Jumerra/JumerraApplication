/**
 * Sentry server-side integration. Skipped entirely in development
 * unless `SENTRY_DSN_SERVER` is explicitly set — keeps local dev free
 * of network round-trips and noisy event spam.
 *
 * `initSentry()` MUST be called before any route is mounted so the
 * SDK can patch http/express handlers in time to capture spans + errors.
 * `sentryErrorHandler()` returns an Express error-handling middleware
 * that forwards uncaught errors to Sentry before our own handler
 * surfaces them to the client.
 */

import * as Sentry from "@sentry/node";
import type { ErrorRequestHandler, Express } from "express";
import { logger } from "./logger";

let _initialized = false;

export function initSentry(): void {
  if (_initialized) return;
  const dsn = process.env.SENTRY_DSN_SERVER;
  if (!dsn) {
    logger.info(
      "Sentry server not initialized (SENTRY_DSN_SERVER not set) — error capture disabled",
    );
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE ?? undefined,
    // Conservative sample rate — we want errors, not perf data.
    tracesSampleRate: 0,
    // PII handling: usernames/IPs/headers are scrubbed below via
    // beforeSend before the event leaves the process.
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip every header we treat as PII in the logger redact list.
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string>;
        for (const k of [
          "authorization",
          "cookie",
          "set-cookie",
          "x-api-key",
        ]) {
          if (k in h) h[k] = "[redacted]";
        }
      }
      // Drop body — it can carry email/phone/password fields.
      if (event.request) {
        delete (event.request as { data?: unknown }).data;
      }
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      return event;
    },
  });
  _initialized = true;
  logger.info(
    { environment: process.env.NODE_ENV },
    "Sentry server initialized",
  );
}

/** Attach the Sentry error handler. Call AFTER all routes are mounted
 * and BEFORE the application's own error-rendering middleware. */
export function attachSentryErrorHandler(app: Express): void {
  if (!_initialized) return;
  Sentry.setupExpressErrorHandler(app);
}

/** Express middleware that forwards uncaught errors to Sentry without
 * swallowing them — used for routes that don't go through Sentry's own
 * patching (background workers, etc.). */
export const sentryNoopErrorHandler: ErrorRequestHandler = (
  err,
  _req,
  _res,
  next,
) => {
  if (_initialized) {
    Sentry.captureException(err);
  }
  next(err);
};

export function captureException(err: unknown): void {
  if (_initialized) Sentry.captureException(err);
}
