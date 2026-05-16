import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildSessionMiddleware, sessionPartitionedCookiePatch } from "./lib/session";
import { sessionTokenBridge } from "./middleware/session-token-bridge";
import { requestIdMiddleware } from "./middleware/request-id";
import { seedSystemRoles } from "./lib/permissions";
import { attachSentryErrorHandler } from "./lib/sentry-server";
import { globalLimiter, searchLimiter } from "./lib/rate-limit";

// Fire-and-forget on boot; logs but doesn't block startup. Safe because
// it's idempotent (no-op when system rows already exist).
seedSystemRoles().catch((err) => {
  logger.error({ err }, "seedSystemRoles failed");
});

const app: Express = express();
app.set("trust proxy", 1);

// Request-id MUST be installed before pino-http so the very first log
// line for the request already carries the id. ULID-based, configurable
// via incoming `x-request-id` for end-to-end tracing.
app.use(requestIdMiddleware());

app.use(
  pinoHttp({
    logger,
    // pino-http will call `req.id ||= genReqId(...)` internally; by
    // returning the id we set above, we keep one canonical id per
    // request across log lines AND the response header.
    genReqId: (req) => (req as unknown as { id?: string }).id ?? "",
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS allowlist.  We must not reflect arbitrary origins because the
// session cookie is `SameSite=None; Secure` (required so the cross-site
// Expo web preview can authenticate), which means browsers will happily
// attach the cookie to credentialed requests from any origin.  Combined
// with `Access-Control-Allow-Credentials: true`, a wildcard/reflective
// origin would let any third-party site call our authenticated API and
// read the response.  Instead we explicitly allow only:
//   - the Replit dev domain (workspace web preview of talent-platform)
//   - the Expo packager dev domain (web preview of talent-mobile)
//   - every domain listed in REPLIT_DOMAINS (production deploys)
//   - localhost for direct local development
// Native requests (iOS / Android Expo Go) do not send an `Origin` header
// and are passed through unchanged — there is no CSRF surface there
// because the cookie is delivered over native `fetch`, not a browser
// context.
function buildAllowedOrigins(): Set<string> {
  const allowed = new Set<string>();

  const addHttps = (host: string | undefined) => {
    if (host && host.length > 0) {
      allowed.add(`https://${host.replace(/^https?:\/\//, "")}`);
    }
  };

  addHttps(process.env.REPLIT_DEV_DOMAIN);
  addHttps(process.env.REPLIT_EXPO_DEV_DOMAIN);

  const productionDomains = process.env.REPLIT_DOMAINS;
  if (productionDomains) {
    for (const domain of productionDomains.split(",")) {
      addHttps(domain.trim());
    }
  }

  // Local development convenience.
  allowed.add("http://localhost");
  allowed.add("http://127.0.0.1");

  return allowed;
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Allow any port on localhost / 127.0.0.1 for native dev tooling that
  // sometimes picks an ephemeral port.
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }
  } catch {
    // Fall through to deny.
  }
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      // Requests without an Origin header (curl, native iOS/Android
      // fetch, server-to-server) are not subject to the browser's
      // same-origin policy and pose no CSRF risk via cookies.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      logger.warn({ origin }, "CORS: rejecting disallowed origin");
      // Return `false` (not an Error) so the request still completes but
      // without `Access-Control-Allow-*` headers — browsers will block JS
      // from reading the response, which is what we want, while avoiding
      // noisy 500s in logs / preflight UX.
      callback(null, false);
    },
    credentials: true,
    // Expose x-request-id so browser clients can surface it in error
    // toasts / Sentry breadcrumbs for correlation with server logs.
    // x-next-cursor is the cursor-pagination next-page handle for hot
    // list endpoints (see lib/pagination.ts).
    exposedHeaders: ["x-request-id", "x-next-cursor"],
  }),
);
// Raw body parsing for payment-provider webhooks MUST come before
// express.json(). Stripe & Paystack both verify deliveries by HMAC of
// the exact bytes sent; if express.json() runs first it parses + drops
// the buffer and signature verification fails for every webhook.
app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json", limit: "1mb" }),
);
app.use(
  "/api/webhooks/paystack",
  express.raw({ type: "application/json", limit: "1mb" }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Patch must run BEFORE express-session so it wraps res.setHeader
// in time to intercept the session cookie that express-session writes.
app.use(sessionPartitionedCookiePatch());
// Bridge `Authorization: Bearer <token>` -> session cookie for clients
// that cannot persist our partitioned cookie (e.g. nested iframe
// previews when the browser blocks third-party cookies).  Must run
// before express-session so the synthesised cookie is visible to it.
app.use(sessionTokenBridge());
app.use(buildSessionMiddleware());

// Process-wide backstop. /api/webhooks/* is explicitly exempted so
// Stripe/Paystack retry storms can never be 429'd — losing a webhook
// event leaks money / leaves a paid CV without its unlock. Per-route
// protection (auth, search) lives in /lib/rate-limit.ts and is wired
// on its specific path so it also bypasses webhooks.
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/webhooks/")) return next();
  return globalLimiter(req, res, next);
});
// Tighter bucket on the hot read paths so unauthenticated scraping
// or hot polling can't pin the DB. 401s still cost a token (we want
// to slow probes), but the 60/min cap leaves plenty of headroom for
// a real client.
app.use(
  ["/api/candidates", "/api/jobs", "/api/applications"],
  (req, _res, next) => {
    // Only throttle reads — POST/PATCH already have permission checks
    // and would otherwise share a bucket with reads on the same path.
    if (req.method !== "GET") return next();
    return searchLimiter(req, _res, next);
  },
);
app.use("/api/institutions", (req, _res, next) => {
  if (req.method !== "GET") return next();
  if (!/\/\d+\/students/.test(req.path)) return next();
  return searchLimiter(req, _res, next);
});

app.use("/api", router);

// Sentry's express error handler runs first (only when initialized),
// then our own JSON error renderer so the client always gets a JSON
// body instead of Express's default HTML 500 page.
attachSentryErrorHandler(app);

const jsonErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Log with the request-id so an operator can grep the same id in
  // Sentry, the response body, and the log stream.
  req.log?.error(
    { err, requestId: (req as unknown as { id?: string }).id },
    "unhandled route error",
  );
  if (res.headersSent) return;
  res.status(500).json({
    error: "Internal server error",
    requestId: (req as unknown as { id?: string }).id ?? null,
  });
};
app.use(jsonErrorHandler);

export default app;
