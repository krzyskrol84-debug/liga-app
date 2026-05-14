import { prisma } from "../lib/prisma.js";
import { seedRankedAccountsJob, type RankedQueue, type RankedSeedTier } from "./SeedRankedAccountsJob.js";
import { updateStatsJob } from "./UpdateStatsJob.js";
import { matchAnalyzer } from "../analytics/MatchAnalyzer.js";
import type { PlatformRegion, RoutingRegion } from "../riot/RiotApiClient.js";

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
      const seedResult = await seedRankedAccountsJob.run({
        platformRegion: input.platformRegion,
        routingRegion: input.routingRegion,
        queue: input.queue,
        tiers: input.tiers,
        limit: input.limit,
      });

      const updateStatsResult = await updateStatsJob.run({
        count: input.count,
        bypassCooldown: true,
      });

      const analyzeGlobalStatsResult = await matchAnalyzer.analyzeGlobalStats();

      const summary: FullRefreshSummary = {
        accountsProcessed: updateStatsResult.accountsProcessed,
        fetchedMatches: updateStatsResult.fetchedMatches,
        skippedMatches: updateStatsResult.skippedMatches,
        analyzedMatches: analyzeGlobalStatsResult.matchesAnalyzed,
        recommendationStatsCount: analyzeGlobalStatsResult.recommendationStatsCount,
        itemStatsCount: analyzeGlobalStatsResult.itemStatsCount,
        matchupStatsCount: analyzeGlobalStatsResult.matchupStatsCount,
        durationMs: Date.now() - startedAt.getTime(),
      };

      await prisma.fetchJobLog.update({
        where: {
          id: pipelineLog.id,
        },
        data: {
          status: "completed",
          finishedAt: new Date(),
          durationMs: summary.durationMs,
          recordsRead: seedResult.fetchedEntries,
          recordsSaved: updateStatsResult.fetchedMatches,
          metadata: JSON.stringify(summary),
        },
      });

      return {
        ok: true,
        summary,
        pipelineLogId: pipelineLog.id,
      };
    } catch (error) {
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
}

async function assertNoRunningFullRefresh() {
  const running = await prisma.fetchJobLog.findFirst({
    where: {
      jobName: "full-refresh",
      status: "running",
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
