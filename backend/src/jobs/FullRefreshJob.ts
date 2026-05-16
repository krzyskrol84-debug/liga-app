import { prisma } from "../lib/prisma.js";
import { seedRankedAccountsJob, type RankedQueue, type RankedSeedTier } from "./SeedRankedAccountsJob.js";
import { updateStatsJob } from "./UpdateStatsJob.js";
import { matchAnalyzer } from "../analytics/MatchAnalyzer.js";
import { compactMatchRecordsJob } from "./CompactMatchRecordsJob.js";
import { cleanupRawPayloadsJob } from "./CleanupRawPayloadsJob.js";
import type { PlatformRegion, RoutingRegion } from "../riot/RiotApiClient.js";
import { markAnalyticsJobFailed, setAnalyticsJobState } from "../lib/analyticsJobState.js";
import { logInfo } from "../lib/logger.js";

export type FullRefreshJobInput = {
  platformRegion: PlatformRegion;
  routingRegion: RoutingRegion;
  queue: RankedQueue;
  tiers: RankedSeedTier[];
  limit: number;
  count: number;
};

export type FullRefreshSummary = {
  accountsProcessed: number;
  fetchedMatches: number;
  skippedMatches: number;
  analyzedMatches: number;
  compactedMatches: number;
  rawPayloadsCleaned: number;
  dbSizeBytes: number | null;
  recommendationStatsCount: number;
  itemStatsCount: number;
  matchupStatsCount: number;
  durationMs: number;
};

export class FullRefreshAlreadyRunningError extends Error {
  constructor() {
    super("full-refresh is already running.");
    this.name = "FullRefreshAlreadyRunningError";
  }
}

export class FullRefreshJob {
  async run(input: FullRefreshJobInput): Promise<{
    ok: true;
    summary: FullRefreshSummary;
    pipelineLogId: string;
  }> {
    await assertNoRunningFullRefresh();

    const startedAt = new Date();
    const pipelineLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "full-refresh",
        status: "running",
        target: `${input.platformRegion}:${input.queue}`,
        startedAt,
        metadata: JSON.stringify({
          platformRegion: input.platformRegion,
          routingRegion: input.routingRegion,
          queue: input.queue,
          tiers: input.tiers,
          limit: input.limit,
          count: input.count,
          trigger: "manual-or-scheduler",
        }),
      },
    });

    try {
      await setAnalyticsJobState({
        status: "running",
        currentStage: "seeding-accounts",
        currentJob: "full-refresh",
        progress: 0,
        processedMatches: 0,
        recommendationStatsAdded: 0,
        itemStatsAdded: 0,
        matchupStatsAdded: 0,
        currentChampion: null,
        currentRole: null,
        errorMessage: null,
        startedAt,
        finishedAt: null,
        metadata: {
          platformRegion: input.platformRegion,
          routingRegion: input.routingRegion,
          queue: input.queue,
          tiers: input.tiers,
          limit: input.limit,
          count: input.count,
        },
      });
      await this.updatePipelineProgress(pipelineLog.id, startedAt, {
        stage: "seed-ranked-accounts",
        progress: 10,
      });
      const seedResult = await seedRankedAccountsJob.run({
        platformRegion: input.platformRegion,
        routingRegion: input.routingRegion,
        queue: input.queue,
        tiers: input.tiers,
        limit: input.limit,
      });

      await this.updatePipelineProgress(pipelineLog.id, startedAt, {
        stage: "update-stats",
        progress: 35,
        seededAccounts: seedResult.addedAccounts,
        skippedDuplicateAccounts: seedResult.skippedDuplicates,
        failedSeedAccounts: seedResult.failedAccounts,
      });
      await setAnalyticsJobState({
        status: "running",
        currentStage: "fetching-matches",
        currentJob: "full-refresh",
        progress: 35,
        metadata: {
          seededAccounts: seedResult.addedAccounts,
          skippedDuplicateAccounts: seedResult.skippedDuplicates,
          failedSeedAccounts: seedResult.failedAccounts,
        },
      });
      const updateStatsResult = await updateStatsJob.run({
        count: input.count,
        bypassCooldown: true,
        analyzeAfterFetch: false,
      });
      logPipelineStage("update-stats", {
        fetchedMatches: updateStatsResult.fetchedMatches,
      });

      await this.updatePipelineProgress(pipelineLog.id, startedAt, {
        stage: "compact-match-records",
        progress: 60,
        fetchedMatches: updateStatsResult.fetchedMatches,
      });
      await setAnalyticsJobState({
        status: "running",
        currentStage: "compacting-matches",
        currentJob: "full-refresh",
        progress: 60,
        processedMatches: updateStatsResult.fetchedMatches,
      });
      const compactResult = await compactMatchRecordsJob.run();
      logPipelineStage("compact-match-records", {
        fetchedMatches: updateStatsResult.fetchedMatches,
        compactedMatches: compactResult.recordsCompacted,
      });

      await this.updatePipelineProgress(pipelineLog.id, startedAt, {
        stage: "analyze-global-stats",
        progress: 70,
        accountsProcessed: updateStatsResult.accountsProcessed,
        fetchedMatches: updateStatsResult.fetchedMatches,
        skippedMatches: updateStatsResult.skippedMatches,
      });
      await setAnalyticsJobState({
        status: "running",
        currentStage: "analyzing-stats",
        currentJob: "full-refresh",
        progress: 70,
        processedMatches: updateStatsResult.fetchedMatches,
        metadata: {
          accountsProcessed: updateStatsResult.accountsProcessed,
          fetchedMatches: updateStatsResult.fetchedMatches,
          skippedMatches: updateStatsResult.skippedMatches,
        },
      });
      const analyzeGlobalStatsResult = await matchAnalyzer.analyzeGlobalStats();
      logPipelineStage("analyze-global-stats", {
        fetchedMatches: updateStatsResult.fetchedMatches,
        compactedMatches: compactResult.recordsCompacted,
        analyzedMatches: analyzeGlobalStatsResult.matchesAnalyzed,
      });
      await this.updatePipelineProgress(pipelineLog.id, startedAt, {
        stage: "cleanup-raw-payloads",
        progress: 90,
        fetchedMatches: updateStatsResult.fetchedMatches,
        compactedMatches: compactResult.recordsCompacted,
        analyzedMatches: analyzeGlobalStatsResult.matchesAnalyzed,
      });
      await setAnalyticsJobState({
        status: "running",
        currentStage: "cleaning-raw-payloads",
        currentJob: "full-refresh",
        progress: 90,
        processedMatches: analyzeGlobalStatsResult.matchesAnalyzed,
      });
      const cleanupResult = await cleanupRawPayloadsJob.run();
      const dbSizeBytes = await getDatabaseSizeBytes();
      logPipelineStage("cleanup-raw-payloads", {
        fetchedMatches: updateStatsResult.fetchedMatches,
        compactedMatches: compactResult.recordsCompacted,
        analyzedMatches: analyzeGlobalStatsResult.matchesAnalyzed,
        rawPayloadsCleaned: cleanupResult.rawPayloadsCleaned,
        dbSizeBytes,
      });
      const finishedAt = new Date();

      const summary: FullRefreshSummary = {
        accountsProcessed: updateStatsResult.accountsProcessed,
        fetchedMatches: updateStatsResult.fetchedMatches,
        skippedMatches: updateStatsResult.skippedMatches,
        compactedMatches: compactResult.recordsCompacted,
        analyzedMatches: analyzeGlobalStatsResult.matchesAnalyzed,
        rawPayloadsCleaned: cleanupResult.rawPayloadsCleaned,
        dbSizeBytes,
        recommendationStatsCount: analyzeGlobalStatsResult.recommendationStatsCount,
        itemStatsCount: analyzeGlobalStatsResult.itemStatsCount,
        matchupStatsCount: analyzeGlobalStatsResult.matchupStatsCount,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };

      await prisma.fetchJobLog.update({
        where: {
          id: pipelineLog.id,
        },
        data: {
          status: "completed",
          finishedAt,
          durationMs: summary.durationMs,
          recordsRead: seedResult.fetchedEntries,
          recordsSaved: updateStatsResult.fetchedMatches,
          metadata: JSON.stringify({
            ...summary,
            stage: "completed",
            progress: 100,
            lastStatsUpdatedAt: finishedAt.toISOString(),
          }),
        },
      });
      await setAnalyticsJobState({
        status: "completed",
        currentStage: "completed",
        currentJob: "full-refresh",
        progress: 100,
        processedMatches: analyzeGlobalStatsResult.matchesAnalyzed,
        recommendationStatsAdded: analyzeGlobalStatsResult.recommendationStatsCount,
        itemStatsAdded: analyzeGlobalStatsResult.itemStatsCount,
        matchupStatsAdded: analyzeGlobalStatsResult.matchupStatsCount,
        currentChampion: null,
        currentRole: null,
        errorMessage: null,
        finishedAt,
        lastStatsUpdatedAt: finishedAt,
        metadata: summary,
      });

      return {
        ok: true,
        summary,
        pipelineLogId: pipelineLog.id,
      };
    } catch (error) {
      await markAnalyticsJobFailed(error, {
        currentJob: "full-refresh",
      });
      await prisma.fetchJobLog.update({
        where: {
          id: pipelineLog.id,
        },
        data: {
          status: "failed",
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          errorMessage: error instanceof Error ? error.message : "Unknown full-refresh error",
        },
      });
      throw error;
    }
  }

  private async updatePipelineProgress(
    pipelineLogId: string,
    startedAt: Date,
    metadata: Record<string, unknown>,
  ) {
    await prisma.fetchJobLog.update({
      where: {
        id: pipelineLogId,
      },
      data: {
        durationMs: Date.now() - startedAt.getTime(),
        metadata: JSON.stringify(metadata),
      },
    });
  }
}

async function assertNoRunningFullRefresh() {
  const running = await prisma.fetchJobLog.findFirst({
    where: {
      status: "running",
      jobName: {
        in: ["full-refresh", "maintenance", "scheduler.full-refresh"],
      },
    },
    orderBy: {
      startedAt: "desc",
    },
  });

  if (running) {
    throw new FullRefreshAlreadyRunningError();
  }
}

export const fullRefreshJob = new FullRefreshJob();

function logPipelineStage(
  currentStage: string,
  metrics: {
    fetchedMatches?: number;
    compactedMatches?: number;
    analyzedMatches?: number;
    rawPayloadsCleaned?: number;
    dbSizeBytes?: number | null;
  },
) {
  logInfo("[pipeline]", {
    currentStage,
    fetchedMatches: metrics.fetchedMatches ?? 0,
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
