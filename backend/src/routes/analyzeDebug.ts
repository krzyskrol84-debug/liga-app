import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const analyzeDebugRouter = Router();

analyzeDebugRouter.get("/analyze-status", async (_request, response, next) => {
  try {
    const [
      totalCompactMatches,
      totalAnalyzedMatches,
      pendingAnalyzeMatches,
      recommendationStatsCount,
      itemStatsCount,
      matchupStatsCount,
      lastFailedAnalyze,
      lastAnalyzeLog,
    ] = await Promise.all([
      prisma.matchRecord.count({
        where: {
          compactPayload: {
            not: null,
          },
        },
      }),
      prisma.matchRecord.count({
        where: {
          analyzedAt: {
            not: null,
          },
        },
      }),
      prisma.matchRecord.count({
        where: {
          compactPayload: {
            not: null,
          },
          analyzedAt: null,
        },
      }),
      prisma.recommendationStats.count({ where: { source: "riot-api" } }),
      prisma.itemStats.count({ where: { source: "riot-api" } }),
      prisma.matchupStats.count({ where: { source: "riot-api" } }),
      prisma.fetchJobLog.findFirst({
        where: {
          jobName: "analyze-global-stats",
          status: "failed",
        },
        orderBy: {
          startedAt: "desc",
        },
        select: {
          errorMessage: true,
        },
      }),
      prisma.fetchJobLog.findFirst({
        where: {
          jobName: "analyze-global-stats",
        },
        orderBy: {
          startedAt: "desc",
        },
        select: {
          metadata: true,
        },
      }),
    ]);

    return response.json({
      totalCompactMatches,
      totalAnalyzedMatches,
      pendingAnalyzeMatches,
      recommendationStatsCount,
      itemStatsCount,
      matchupStatsCount,
      lastAnalyzeError: lastFailedAnalyze?.errorMessage ?? null,
      lastProcessedMatchId: readLastProcessedMatchId(lastAnalyzeLog?.metadata ?? null),
    });
  } catch (error) {
    next(error);
  }
});

function readLastProcessedMatchId(metadata: string | null) {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata) as {
      jobStatus?: unknown;
      currentMatchId?: unknown;
      metadata?: { currentMatchId?: unknown };
    };

    if (typeof parsed.currentMatchId === "string") {
      return parsed.currentMatchId;
    }

    if (typeof parsed.metadata?.currentMatchId === "string") {
      return parsed.metadata.currentMatchId;
    }

    return null;
  } catch {
    return null;
  }
}
