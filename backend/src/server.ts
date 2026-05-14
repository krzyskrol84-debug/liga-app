import cors from "cors";
import express from "express";
import helmet from "helmet";
import { backendConfig, getRiotApiKeyDebugInfo } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { healthRouter } from "./routes/health.js";
import { dataDragonRouter } from "./routes/dataDragon.js";
import { riotRouter } from "./routes/riot.js";
import { jobsRouter } from "./routes/jobs.js";
import { recommendationsRouter } from "./routes/recommendations.js";
import { matchupsRouter } from "./routes/matchups.js";
import { itemsRouter } from "./routes/items.js";
import { trackedAccountsRouter } from "./routes/trackedAccounts.js";
import { diagnosticsRouter } from "./routes/diagnostics.js";
import { statsScheduler } from "./jobs/StatsScheduler.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    callback(null, backendConfig.corsOrigins.includes(origin));
  },
}));
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);
app.use(rateLimitMiddleware);

app.use("/health", healthRouter);
app.use("/api", dataDragonRouter);
app.use("/api/riot", riotRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/matchups", matchupsRouter);
app.use("/api/items", itemsRouter);
app.use("/api/tracked-accounts", trackedAccountsRouter);
app.use("/api/diagnostics", diagnosticsRouter);

app.use(errorHandler);

const server = app.listen(backendConfig.port, () => {
  const riotApiKeyDebug = getRiotApiKeyDebugInfo(backendConfig.riotApiKey);
  console.info("[backend] Environment loaded.", {
    envFilePath: backendConfig.envFilePath,
    riotApiKeyLoaded: riotApiKeyDebug.loaded,
    keyPrefix: riotApiKeyDebug.prefix,
    keySuffix: riotApiKeyDebug.suffix,
    note: "Changing backend/.env requires a backend restart.",
    corsOrigins: backendConfig.corsOrigins,
  });
  console.log(`liga-backend listening on http://127.0.0.1:${backendConfig.port}`);

  if (backendConfig.enableScheduler) {
    statsScheduler.start();
    console.info("[backend] Stats scheduler enabled.", {
      intervalHours: backendConfig.statsUpdateIntervalHours,
      defaults: {
        platformRegion: "eun1",
        routingRegion: "europe",
        queue: "RANKED_SOLO_5x5",
        tiers: ["CHALLENGER", "GRANDMASTER", "MASTER"],
        limit: 200,
        count: 20,
      },
    });
  } else {
    console.info("[backend] Stats scheduler disabled.");
  }
});

let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.info("[backend] graceful shutdown started.", { signal });
  statsScheduler.stop();

  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.info("[backend] Prisma disconnected.");
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => {
    console.error("[backend] graceful shutdown timed out.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
