// Sentry must initialize before any module that uses http/express so
// its instrumentation can patch the runtime in time. Same for env
// validation — fail loudly + early rather than on the first request.
import { initSentry } from "./lib/sentry-server";
import { validateEnv } from "./lib/env-validator";

validateEnv();
initSentry();

import app from "./app";
import { logger } from "./lib/logger";
import { startEngagementScheduler } from "./lib/digest-worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startEngagementScheduler();
});
