import express from "express";
import cors from "cors";
import morgan from "morgan";

import { env } from "./config/env.js";
import { registerRoutes } from "./routes/index.js";
import { notFoundHandler, errorHandler } from "./utils/http.js";
import { checkDbConnection } from "./db/client.js";

const app = express();

app.use(cors());
app.use("/api/discussions/images", express.json({ limit: "7mb" }));
app.use("/api/admin/imports", express.json({ limit: "17mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "alevel-smart-practice-backend",
    message: "Backend is running. Use /health or /api/* endpoints.",
    docs: {
      health: "/health",
      curriculum: "/api/meta/curriculum",
      stats: "/api/meta/stats",
      storage: "/api/meta/storage",
      adminRecords: "/api/admin/records",
      discussions: "/api/discussions",
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "alevel-smart-practice-backend",
    database: {
      enabled: env.dbEnabled,
    },
    timestamp: new Date().toISOString(),
  });
});

registerRoutes(app);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, async () => {
  const dbStatus = await checkDbConnection();

  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${env.port}`);
  // eslint-disable-next-line no-console
  console.log(`DB enabled: ${env.dbEnabled ? "yes" : "no"}`);

  if (dbStatus.enabled && dbStatus.ok) {
    // eslint-disable-next-line no-console
    console.log(`DB connection ok at ${dbStatus.now}`);
    return;
  }

  if (dbStatus.enabled && !dbStatus.ok) {
    // eslint-disable-next-line no-console
    console.error(`DB connection failed: ${dbStatus.reason}`);
    if (env.dbRequired) {
      process.exit(1);
    }
  }
});
