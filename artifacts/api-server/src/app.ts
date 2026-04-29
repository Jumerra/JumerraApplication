import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildSessionMiddleware, sessionPartitionedCookiePatch } from "./lib/session";
import { sessionTokenBridge } from "./middleware/session-token-bridge";
import { seedSystemRoles } from "./lib/permissions";

// Fire-and-forget on boot; logs but doesn't block startup. Safe because
// it's idempotent (no-op when system rows already exist).
seedSystemRoles().catch((err) => {
  logger.error({ err }, "seedSystemRoles failed");
});

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
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
  }),
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

app.use("/api", router);

export default app;
