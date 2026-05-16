/**
 * Request-id middleware. Generates a ULID per request, attaches it to
 * `req.id` (which pino-http already serialises into every log line),
 * and echoes it back to the caller as `x-request-id`. Honours an
 * incoming `x-request-id` header so an upstream proxy / mobile client
 * can propagate its own correlation id end-to-end.
 *
 * MUST be mounted BEFORE `pino-http` so the request logger captures
 * the generated id on the very first log line.
 */

import type { RequestHandler } from "express";
import { ulid } from "ulid";

// Reasonable defensive cap — long enough for a ULID (26) or a UUID-v4
// (36) but short enough to reject malicious header stuffing.
const MAX_LEN = 64;
const SAFE_RE = /^[A-Za-z0-9._-]+$/;

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header("x-request-id");
    const id =
      incoming && incoming.length <= MAX_LEN && SAFE_RE.test(incoming)
        ? incoming
        : ulid();
    // Express 5 doesn't have a typed req.id; we add it ad-hoc.
    (req as unknown as { id: string }).id = id;
    res.setHeader("x-request-id", id);
    next();
  };
}
