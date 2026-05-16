import { Router } from "express";
import { backendConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { dataDragonService } from "../riot/DataDragonService.js";
import { getAnalyticsJobState } from "../lib/analyticsJobState.js";

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
      dbSize,
      payloadSizes,
      matchLifecycleCounts,
      analyticsJobState,
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
      getDatabaseSizeDiagnostics(),
      getMatchPayloadSizeDiagnostics(),
      getMatchLifecycleDiagnostics(),
      getAnalyticsJobState(),
    ]);

    return response.json({
      ok: true,
      backendOnline: true,
      riotApiAvailable: backendConfig.riotApiKey.trim().length > 0,
      latestPatch,
      dbSize,
      payloadSizes,
      rawPayloadBytes: payloadSizes?.rawPayloadBytes ?? 0,
      compactPayloadBytes: payloadSizes?.compactPayloadBytes ?? 0,
      dbSizeBytes: dbSize?.databaseSizeBytes ?? null,
      lastStatsUpdatedAt: analyticsJobState?.lastStatsUpdatedAt?.toISOString() ?? null,
      ...matchLifecycleCounts,
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

async function getMatchLifecycleDiagnostics() {
  const [rawMatchesCount, analyzedMatchesCount, unanalyzedMatchesCount, compactedMatchesCount] =
    await Promise.all([
      prisma.matchRecord.count({
        where: {
          rawPayload: {
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
          analyzedAt: null,
        },
      }),
      prisma.matchRecord.count({
        where: {
          compactedAt: {
            not: null,
          },
        },
      }),
    ]);

  return {
    rawMatchesCount,
    analyzedMatchesCount,
    unanalyzedMatchesCount,
    compactedMatchesCount,
  };
}

async function getDatabaseSizeDiagnostics() {
  const rows = await prisma.$queryRaw<Array<{
    database_size_bytes: bigint;
    match_record_total_bytes: bigint;
    match_record_table_bytes: bigint;
    match_record_indexes_bytes: bigint;
  }>>`
    SELECT
      pg_database_size(current_database()) AS database_size_bytes,
      pg_total_relation_size('"MatchRecord"') AS match_record_total_bytes,
      pg_relation_size('"MatchRecord"') AS match_record_table_bytes,
      pg_indexes_size('"MatchRecord"') AS match_record_indexes_bytes
  `;
  const row = rows[0];
  return row
    ? {
        databaseSizeBytes: Number(row.database_size_bytes),
        matchRecordTotalBytes: Number(row.match_record_total_bytes),
        matchRecordTableBytes: Number(row.match_record_table_bytes),
        matchRecordIndexesBytes: Number(row.match_record_indexes_bytes),
      }
    : null;
}

async function getMatchPayloadSizeDiagnostics() {
  const rows = await prisma.$queryRaw<Array<{
    records_with_raw_payload: bigint;
    records_with_compact_payload: bigint;
    raw_payload_bytes: bigint;
    compact_payload_bytes: bigint;
  }>>`
    SELECT
      COUNT(*) FILTER (WHERE "rawPayload" IS NOT NULL) AS records_with_raw_payload,
      COUNT(*) FILTER (WHERE "compactPayload" IS NOT NULL) AS records_with_compact_payload,
      COALESCE(SUM(octet_length("rawPayload")), 0) AS raw_payload_bytes,
      COALESCE(SUM(octet_length("compactPayload")), 0) AS compact_payload_bytes
    FROM "MatchRecord"
  `;
  const row = rows[0];
  return row
    ? {
        recordsWithRawPayload: Number(row.records_with_raw_payload),
        recordsWithCompactPayload: Number(row.records_with_compact_payload),
        rawPayloadBytes: Number(row.raw_payload_bytes),
        compactPayloadBytes: Number(row.compact_payload_bytes),
      }
    : null;
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
