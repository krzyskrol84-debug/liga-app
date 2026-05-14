import { prisma } from "../lib/prisma.js";
import { matchAnalyzer } from "../analytics/MatchAnalyzer.js";
import { assertNoRunningJob } from "../lib/jobGuards.js";
import { FetchMatchesJob, type TrackedAccountLike } from "./FetchMatchesJob.js";

const ACCOUNT_COOLDOWN_MS = 90_000;
const JOB_COOLDOWN_MS = 60_000;
const BETWEEN_ACCOUNTS_DELAY_MS = 750;

export class UpdateStatsCooldownError extends Error {
  public readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "UpdateStatsCooldownError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type UpdateStatsJobInput = {
  count?: number;
  bypassCooldown?: boolean;
};

export type UpdateStatsJobResult = {
  ok: true;
  accountsProcessed: number;
  fetchedMatches: number;
  skippedMatches: number;
  analyzedMatches: number;
  recommendationsUpdated: number;
  itemStatsUpdated: number;
  matchupStatsUpdated: number;
};

export class UpdateStatsJob {
  private readonly fetchMatchesJob: FetchMatchesJob;

  constructor(fetchMatchesJob = new FetchMatchesJob()) {
    this.fetchMatchesJob = fetchMatchesJob;
  }

  async run(input: UpdateStatsJobInput = {}): Promise<UpdateStatsJobResult> {
    await assertNoRunningJob("update-stats");
    if (!input.bypassCooldown) {
      await assertJobCooldown();
    }

    const startedAt = new Date();
    const requestedCount = normalizeRequestedCount(input.count);
    const jobLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "update-stats",
        status: "running",
        target: "tracked-accounts",
        startedAt,
        metadata: JSON.stringify({
          requestedCount,
          bypassCooldown: Boolean(input.bypassCooldown),
        }),
      },
    });

    try {
      const trackedAccounts = await prisma.trackedAccount.findMany({
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });

      let accountsProcessed = 0;
      let fetchedMatches = 0;
      let skippedMatches = 0;

      for (const trackedAccount of trackedAccounts) {
        if (shouldSkipAccount(trackedAccount.lastFetchedAt)) {
          continue;
        }

        const result = await this.fetchMatchesJob.fetchAndStoreMatchesForAccount(
          trackedAccount as TrackedAccountLike,
          requestedCount,
        );

        accountsProcessed += 1;
        fetchedMatches += result.savedMatches;
        skippedMatches += result.skippedExisting;

        await prisma.trackedAccount.update({
          where: {
            id: trackedAccount.id,
          },
          data: {
            lastFetchedAt: new Date(),
          },
        });

        await sleep(BETWEEN_ACCOUNTS_DELAY_MS);
      }

      const globalAnalysis = await matchAnalyzer.analyzeGlobalStats();

      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: {
          id: jobLog.id,
        },
        data: {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          recordsRead: trackedAccounts.length,
          recordsSaved: fetchedMatches,
          metadata: JSON.stringify({
            accountsProcessed,
            fetchedMatches,
            skippedMatches,
            analyzedMatches: globalAnalysis.matchesAnalyzed,
            recommendationsUpdated: globalAnalysis.recommendationStatsCount,
            itemStatsUpdated: globalAnalysis.itemStatsCount,
            matchupStatsUpdated: globalAnalysis.matchupStatsCount,
          }),
        },
      });

      return {
        ok: true,
        accountsProcessed,
        fetchedMatches,
        skippedMatches,
        analyzedMatches: globalAnalysis.matchesAnalyzed,
        recommendationsUpdated: globalAnalysis.recommendationStatsCount,
        itemStatsUpdated: globalAnalysis.itemStatsCount,
        matchupStatsUpdated: globalAnalysis.matchupStatsCount,
      };
    } catch (error) {
      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: {
          id: jobLog.id,
        },
        data: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: getSafeErrorMessage(error),
        },
      });
      throw error;
    }
  }
}

async function assertJobCooldown() {
  const latestJob = await prisma.fetchJobLog.findFirst({
    where: {
      jobName: "update-stats",
      status: {
        in: ["running", "completed"],
      },
    },
    orderBy: {
      startedAt: "desc",
    },
  });

  if (!latestJob) {
    return;
  }

  const elapsedMs = Date.now() - latestJob.startedAt.getTime();
  if (latestJob.status === "running" || elapsedMs < JOB_COOLDOWN_MS) {
    const retryAfterMs = Math.max(JOB_COOLDOWN_MS - elapsedMs, 1_000);
    throw new UpdateStatsCooldownError(
      `update-stats is cooling down. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
      Math.ceil(retryAfterMs / 1000),
    );
  }
}

function shouldSkipAccount(lastFetchedAt: Date | null): boolean {
  if (!lastFetchedAt) {
    return false;
  }

  return Date.now() - lastFetchedAt.getTime() < ACCOUNT_COOLDOWN_MS;
}

function normalizeRequestedCount(count: number | undefined) {
  if (!Number.isInteger(count) || !count) {
    return 20;
  }

  return Math.min(Math.max(count, 1), 100);
}

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

export const updateStatsJob = new UpdateStatsJob();
