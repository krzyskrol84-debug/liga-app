import cors from "cors";
import express from "express";
import helmet from "helmet";
import { backendConfig, getDatabaseUrlDebugInfo, getRiotApiKeyDebugInfo } from "./config.js";
import { logError, logInfo, logWarn } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { noStoreForApiRoutes } from "./middleware/noStore.js";
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
import { debugRouter } from "./routes/debug.js";
import { versionRouter } from "./routes/version.js";
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
app.use(noStoreForApiRoutes);
app.use(requestLogger);
app.use(rateLimitMiddleware);

app.use("/health", healthRouter);
app.use("/api/version", versionRouter);
app.use("/api", dataDragonRouter);
app.use("/api/riot", riotRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/matchups", matchupsRouter);
app.use("/api/items", itemsRouter);
app.use("/api/tracked-accounts", trackedAccountsRouter);
app.use("/api/diagnostics", diagnosticsRouter);
app.use("/api/debug", debugRouter);

app.use(errorHandler);

const databaseUrlDebug = getDatabaseUrlDebugInfo(process.env.DATABASE_URL);
let server: ReturnType<typeof app.listen> | null = null;

async function startServer() {
  if (databaseUrlDebug.loaded) {
    try {
      await prisma.$connect();
      logInfo("[db] connected to postgres");
    } catch (error) {
      logError("[db] postgres connection failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  } else {
    logWarn("[db] DATABASE_URL is not configured. Health checks will report database unavailable.");
  }

  server = app.listen(backendConfig.port, () => {
    const riotApiKeyDebug = getRiotApiKeyDebugInfo(backendConfig.riotApiKey);
    logInfo("Environment loaded.", {
      envFilePath: backendConfig.envFilePath,
      logLevel: backendConfig.logLevel,
      riotApiKeyLoaded: riotApiKeyDebug.loaded,
      keyPrefix: riotApiKeyDebug.prefix,
      keySuffix: riotApiKeyDebug.suffix,
      databaseUrlLoaded: databaseUrlDebug.loaded,
      note: "Changing backend/.env requires a backend restart.",
      corsOrigins: backendConfig.corsOrigins,
    });
    logInfo("liga-backend listening.", {
      url: `http://127.0.0.1:${backendConfig.port}`,
    });

    if (backendConfig.enableScheduler) {
      statsScheduler.start();
      logInfo("Stats scheduler enabled.", {
        intervalHours: backendConfig.statsUpdateIntervalHours,
        defaults: {
          platformRegion: "eun1",
        routingRegion: "europe",
        queue: "RANKED_SOLO_5x5",
        tiers: ["CHALLENGER", "GRANDMASTER", "MASTER"],
        limit: 1000,
        count: 80,
      },
      });
    } else {
      logInfo("Stats scheduler disabled.");
    }
  });
}

void startServer();

let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logInfo("Graceful shutdown started.", { signal });
  statsScheduler.stop();

  if (!server) {
    await prisma.$disconnect();
    process.exit(0);
  }

  server.close(async () => {
    try {
      await prisma.$disconnect();
      logInfo("Prisma disconnected.");
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
