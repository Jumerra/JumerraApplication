/**
 * Centralised rate-limit definitions.
 *
 * Three buckets:
 *   - authLimiter:   10 / 15 min — applied to login/register/forgot/reset
 *                    to slow online password / enumeration attacks.
 *   - searchLimiter: 60 / min    — applied to expensive list endpoints
 *                    (/candidates, /jobs, /applications, /institutions/
 *                    :id/students) so unauthenticated scraping or hot
 *                    polling can't pin the DB.
 *   - globalLimiter: 1000 / 15 min — last-ditch process-wide backstop.
 *
 * All three send standardised `RateLimit-*` headers and a 429 with
 * `Retry-After` when a client trips a bucket. The store is the
 * built-in in-memory MemoryStore — fine for a single-process server.
 * If we ever fan out to multiple instances behind a load balancer
 * we'll need to swap to `rate-limit-redis` or similar; until then
 * the cheaper in-memory store is the right call.
 *
 * `trustProxy` is enabled at the app level (`app.set('trust proxy', 1)`),
 * so `req.ip` is the original client IP through the Replit proxy.
 */
import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from "express-rate-limit";

const MINUTE = 60 * 1000;

export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Include a stable identifier so a shared IP behind NAT doesn't
  // accidentally lock everyone out via someone else's typo storm.
  // Falls back to req.ip when no body/email is present.
  // ipKeyGenerator normalises IPv6 to a /64 prefix so an attacker
  // can't trivially escape the bucket by hopping addresses inside
  // their assigned block. Required by express-rate-limit ≥7.
  keyGenerator: (req, res) => {
    const body = (req.body ?? {}) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.toLowerCase() : "";
    const ipKey = req.ip ? ipKeyGenerator(req.ip) : "noip";
    return `${ipKey}|${email}`;
  },
  message: { error: "Too many auth attempts. Please try again later." },
});

export const searchLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 1 * MINUTE,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

export const globalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});
