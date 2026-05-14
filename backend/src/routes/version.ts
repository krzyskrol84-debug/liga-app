import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const buildTime = process.env.BUILD_TIME ?? process.env.RAILWAY_DEPLOYMENT_CREATED_AT ?? new Date().toISOString();
const version = process.env.npm_package_version ?? "0.1.0";

export const versionRouter = Router();

versionRouter.get("/", async (_request, response, next) => {
  try {
    const latestStatsUpdate = await prisma.fetchJobLog.findFirst({
      where: {
        status: "completed",
        jobName: {
          in: ["analyze-global-stats", "analyze-matches", "analyze-matchups", "update-stats", "full-refresh"],
        },
      },
      orderBy: {
        finishedAt: "desc",
      },
    });

    return response.json({
      version,
      buildTime,
      statsUpdatedAt: latestStatsUpdate?.finishedAt?.toISOString() ?? null,
    });
  } catch (error) {
    next(error);
  }
});
