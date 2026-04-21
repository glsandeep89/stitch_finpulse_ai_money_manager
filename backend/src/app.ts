import express from "express";
import cors from "cors";
import { config, normalizeSiteOrigin } from "./config.js";
import { plaidRouter } from "./routes/plaid.js";
import { dataRouter } from "./routes/data.js";
import { aiRouter } from "./routes/ai.js";
import { jobsRouter } from "./routes/jobs.js";
import { householdRouter } from "./routes/household.js";
import { profileRouter } from "./routes/profile.js";

export function createApp() {
  const app = express();

  const staticOrigins = [...new Set(config.frontendUrls)];
  const devLocalOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const o = normalizeSiteOrigin(origin);
        if (config.nodeEnv === "development" && devLocalOrigin.test(o)) {
          callback(null, true);
          return;
        }
        const allowed = staticOrigins.some((u) => u === o);
        callback(null, allowed);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "finpulse-api" });
  });

  app.use("/plaid", plaidRouter);
  app.use("/", dataRouter);
  app.use("/households", householdRouter);
  app.use("/", profileRouter);
  app.use("/ai", aiRouter);
  app.use("/jobs", jobsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
