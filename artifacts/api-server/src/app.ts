import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildSessionMiddleware } from "./lib/session";
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
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(buildSessionMiddleware());

app.use("/api", router);

export default app;
