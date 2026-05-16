import { prisma } from "../lib/prisma.js";
import { matchAnalyzer } from "../analytics/MatchAnalyzer.js";
import { markAnalyticsJobFailed, setAnalyticsJobState } from "../lib/analyticsJobState.js";
import { compactMatchRecordsJob } from "./CompactMatchRecordsJob.js";
import { cleanupRawPayloadsJob } from "./CleanupRawPayloadsJob.js";
import { logInfo } from "../lib/logger.js";

export type MaintenanceSummary = {
  compactedMatches: number;
  analyzedMatches: number;
  rawPayloadsCleaned: number;
  dbSizeBytes: number | null;
  durationMs: number;
};

export class MaintenanceAlreadyRunningError extends Error {
  constructor() {
    super("maintenance is already running.");
    this.name = "MaintenanceAlreadyRunningError";
  }
}

export class MaintenanceJob {
  async run(): Promise<{ ok: true; summary: MaintenanceSummary }> {
    await assertNoRunningMaintenance();
    const startedAt = new Date();
    const pipelineLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "maintenance",
        status: "running",
        target: "match-records",
        startedAt,
      },
    });

    try {
      await setAnalyticsJobState({
        status: "running",
        currentStage: "compacting-matches",
        currentJob: "maintenance",
        progress: 10,
        startedAt,
      });
      const compactResult = await compactMatchRecordsJob.run();
      logMaintenanceStage("compact-match-records", {
        compactedMatches: compactResult.recordsCompacted,
      });

      await setAnalyticsJobState({
        status: "running",
        currentStage: "analyzing-stats",
        currentJob: "maintenance",
        progress: 45,
      });
      const analyzeResult = await matchAnalyzer.analyzeGlobalStats();
      logMaintenanceStage("analyze-global-stats", {
        compactedMatches: compactResult.recordsCompacted,
        analyzedMatches: analyzeResult.matchesAnalyzed,
      });

      await setAnalyticsJobState({
        status: "running",
        currentStage: "cleaning-raw-payloads",
        currentJob: "maintenance",
        progress: 80,
      });
      const cleanupResult = await cleanupRawPayloadsJob.run();
      const dbSizeBytes = await getDatabaseSizeBytes();
      logMaintenanceStage("cleanup-raw-payloads", {
        compactedMatches: compactResult.recordsCompacted,
        analyzedMatches: analyzeResult.matchesAnalyzed,
        rawPayloadsCleaned: cleanupResult.rawPayloadsCleaned,
        dbSizeBytes,
      });
      const finishedAt = new Date();
      const summary = {
        compactedMatches: compactResult.recordsCompacted,
        analyzedMatches: analyzeResult.matchesAnalyzed,
        rawPayloadsCleaned: cleanupResult.rawPayloadsCleaned,
        dbSizeBytes,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };

      await prisma.fetchJobLog.update({
        where: { id: pipelineLog.id },
        data: {
          status: "completed",
          finishedAt,
          durationMs: summary.durationMs,
          recordsSaved: summary.rawPayloadsCleaned,
          metadata: JSON.stringify({
            ...summary,
            currentStage: "completed",
          }),
        },
      });
      await setAnalyticsJobState({
        status: "completed",
        currentStage: "completed",
        currentJob: "maintenance",
        progress: 100,
        processedMatches: summary.analyzedMatches,
        finishedAt,
        lastStatsUpdatedAt: finishedAt,
        metadata: summary,
      });

      return { ok: true, summary };
    } catch (error) {
      await markAnalyticsJobFailed(error, {
        currentJob: "maintenance",
      });
      await prisma.fetchJobLog.update({
        where: { id: pipelineLog.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }
}

async function assertNoRunningMaintenance() {
  const running = await prisma.fetchJobLog.findFirst({
    where: {
      status: "running",
      jobName: {
        in: ["maintenance", "full-refresh", "scheduler.full-refresh"],
      },
    },
  });
  if (running) {
    throw new MaintenanceAlreadyRunningError();
  }
}

export const maintenanceJob = new MaintenanceJob();

function logMaintenanceStage(
  currentStage: string,
  metrics: {
    compactedMatches?: number;
    analyzedMatches?: number;
    rawPayloadsCleaned?: number;
    dbSizeBytes?: number | null;
  },
) {
  logInfo("[maintenance]", {
    currentStage,
    fetchedMatches: 0,
    compactedMatches: metrics.compactedMatches ?? 0,
    analyzedMatches: metrics.analyzedMatches ?? 0,
    rawPayloadsCleaned: metrics.rawPayloadsCleaned ?? 0,
    dbSizeBytes: metrics.dbSizeBytes ?? null,
  });
}

async function getDatabaseSizeBytes() {
  const rows = await prisma.$queryRaw<Array<{ database_size_bytes: bigint }>>`
    SELECT pg_database_size(current_database()) AS database_size_bytes
  `;
  return rows[0] ? Number(rows[0].database_size_bytes) : null;
}
