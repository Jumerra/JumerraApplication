import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Global pino logger with PII redaction.
 *
 * The `redact` array is intentionally exhaustive across the field
 * shapes our routes use. Pino's path matcher requires explicit paths,
 * so for fields that can appear at any nesting depth (e.g. `email`,
 * `phone`) we list both the top-level form and the `*.email` /
 * `*.*.email` variants so anything within one or two levels of an
 * Express log object is caught.
 *
 * Anything matched is replaced with the literal string `[redacted]`.
 * Note: this affects log output only — the values still flow through
 * the route handler itself unchanged.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      // Auth headers
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-api-key"]',
      "res.headers['set-cookie']",
      // Top-level PII fields commonly attached to log objects
      "email",
      "phone",
      "password",
      "passwordHash",
      "newPassword",
      "currentPassword",
      "token",
      "bearer",
      "authorization",
      "cookie",
      // One- and two-level nestings (covers req.body.email, req.body.user.email,
      // err.email, etc.) — pino does not support deep wildcards.
      "*.email",
      "*.phone",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.bearer",
      "*.authorization",
      "*.cookie",
      "*.*.email",
      "*.*.phone",
      "*.*.password",
      "*.*.passwordHash",
      "*.*.token",
      "*.*.bearer",
    ],
    censor: "[redacted]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
