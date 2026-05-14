import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { dataDragonService } from "../riot/DataDragonService.js";

export const diagnosticsRouter = Router();

diagnosticsRouter.get("/", async (_request, response, next) => {
  try {
    const [
      trackedAccountsCount,
      matchRecordsCount,
      recommendationStatsCount,
      itemStatsCount,
      matchupStatsCount,
      lastFullRefresh,
      lastErrors,
      rateLimitStatus,
      latestPatch,
    ] = await Promise.all([
      prisma.trackedAccount.count(),
      prisma.matchRecord.count(),
      prisma.recommendationStats.count({ where: { source: "riot-api" } }),
      prisma.itemStats.count({ where: { source: "riot-api" } }),
      prisma.matchupStats.count({ where: { source: "riot-api" } }),
      prisma.fetchJobLog.findFirst({
        where: { jobName: "full-refresh" },
        orderBy: { startedAt: "desc" },
      }),
      prisma.fetchJobLog.findMany({
        where: { status: "failed" },
        orderBy: { startedAt: "desc" },
        take: 5,
      }),
      prisma.fetchJobLog.findFirst({
        where: { status: "retrying" },
        orderBy: { startedAt: "desc" },
      }),
      getLatestPatchSafe(),
    ]);

    return response.json({
      ok: true,
      backendOnline: true,
      latestPatch,
      trackedAccountsCount,
      matchRecordsCount,
      recommendationStatsCount,
      itemStatsCount,
      matchupStatsCount,
      lastFullRefresh: lastFullRefresh
        ? {
            status: lastFullRefresh.status,
            startedAt: lastFullRefresh.startedAt.toISOString(),
            finishedAt: lastFullRefresh.finishedAt?.toISOString() ?? null,
            durationMs: lastFullRefresh.durationMs ?? null,
            metadata: parseMetadata(lastFullRefresh.metadata),
          }
        : null,
      lastErrors: lastErrors.map((entry) => ({
        jobName: entry.jobName,
        target: entry.target,
        startedAt: entry.startedAt.toISOString(),
        errorMessage: entry.errorMessage,
      })),
      rateLimitStatus: formatRateLimitStatus(rateLimitStatus),
    });
  } catch (error) {
    next(error);
  }
});

async function getLatestPatchSafe() {
  try {
    const result = await dataDragonService.getLatestPatch();
    return {
      patch: result.patch,
      source: result.source,
      cached: result.cached,
    };
  } catch {
    return null;
  }
}

function parseMetadata(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function formatRateLimitStatus(
  latestRetryLog: {
    startedAt: Date;
    metadata: string | null;
  } | null,
) {
  if (!latestRetryLog) {
    return null;
  }

  const metadata = parseMetadata(latestRetryLog.metadata);
  if (!metadata || typeof metadata !== "object") {
    return {
      active: false,
      lastRetryAt: latestRetryLog.startedAt.toISOString(),
    };
  }

  const retryMetadata = metadata as Record<string, unknown>;
  return {
    active: retryMetadata.statusCode === 429,
    statusCode: typeof retryMetadata.statusCode === "number" ? retryMetadata.statusCode : null,
    retryAfterMs:
      typeof retryMetadata.retryAfterMs === "number" ? retryMetadata.retryAfterMs : null,
    lastRetryAt: latestRetryLog.startedAt.toISOString(),
  };
}
