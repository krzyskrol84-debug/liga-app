import { prisma } from "../lib/prisma.js";
import { matchAnalyzer } from "../analytics/MatchAnalyzer.js";
import { assertNoRunningJob } from "../lib/jobGuards.js";
import { FetchMatchesJob, type TrackedAccountLike } from "./FetchMatchesJob.js";
import { RiotApiError } from "../riot/RiotApiClient.js";
import { backendConfig } from "../config.js";
import { markAnalyticsJobFailed, setAnalyticsJobState } from "../lib/analyticsJobState.js";

const JOB_COOLDOWN_MS = 60_000;
const BETWEEN_ACCOUNTS_DELAY_MS = 750;
const PROGRESS_SAVE_INTERVAL = 50;
const MATCH_LIST_WORKERS = 2;
const RETRYABLE_ACCOUNT_ERROR_STATUSES = new Set([429, 500, 502, 503, 504]);

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
  analyzeAfterFetch?: boolean;
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
    const analyzeAfterFetch = input.analyzeAfterFetch ?? true;
    await setAnalyticsJobState({
      status: "running",
      currentStage: "fetching-matches",
      currentJob: "update-stats",
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
        requestedCount,
        bypassCooldown: Boolean(input.bypassCooldown),
      },
    });
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
      const trackedAccounts = (await prisma.trackedAccount.findMany({
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })).sort(compareTrackedAccountPriority);

      let accountsProcessed = 0;
      let accountsVisited = 0;
      let fetchedMatches = 0;
      let skippedMatches = 0;
      let failedAccounts = 0;
      let retryScheduledAccounts = 0;
      let accountIndex = 0;

      const processNextAccount = async () => {
        while (accountIndex < trackedAccounts.length) {
          const trackedAccount = trackedAccounts[accountIndex];
          accountIndex += 1;

          if (!trackedAccount) {
            continue;
          }

          accountsVisited += 1;
          if (shouldSkipAccount(trackedAccount.lastFetchedAt)) {
            continue;
          }

          let result: Awaited<ReturnType<FetchMatchesJob["fetchAndStoreMatchesForAccount"]>>;
          try {
            result = await this.fetchMatchesJob.fetchAndStoreMatchesForAccount(
              trackedAccount as TrackedAccountLike,
              requestedCount,
            );
          } catch (error) {
            failedAccounts += 1;
            if (isRetryableRiotError(error)) {
              retryScheduledAccounts += 1;
            }

            await prisma.fetchJobLog.create({
              data: {
                jobName: "update-stats.account",
                status: isRetryableRiotError(error) ? "retrying" : "failed",
                target: `${trackedAccount.gameName}#${trackedAccount.tagLine}`,
                startedAt: new Date(),
                finishedAt: new Date(),
                errorMessage: getSafeErrorMessage(error),
                metadata: JSON.stringify({
                  puuid: trackedAccount.puuid,
                  platformRegion: trackedAccount.platformRegion,
                  routingRegion: trackedAccount.routingRegion,
                  statusCode: error instanceof RiotApiError ? error.status : null,
                  retryScheduled: isRetryableRiotError(error),
                  retryReason: "next update-stats run",
                }),
              },
            });

            await sleep(BETWEEN_ACCOUNTS_DELAY_MS);
            continue;
          }

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

          if (accountsVisited % PROGRESS_SAVE_INTERVAL === 0) {
            await saveUpdateStatsProgress({
              jobLogId: jobLog.id,
              startedAt,
              accountsVisited,
              totalAccounts: trackedAccounts.length,
              accountsProcessed,
              fetchedMatches,
              skippedMatches,
              failedAccounts,
              retryScheduledAccounts,
            });
          }
        }
      };

      await Promise.all(Array.from({ length: MATCH_LIST_WORKERS }, () => processNextAccount()));

      await saveUpdateStatsProgress({
        jobLogId: jobLog.id,
        startedAt,
        accountsVisited,
        totalAccounts: trackedAccounts.length,
        accountsProcessed,
        fetchedMatches,
        skippedMatches,
        failedAccounts,
        retryScheduledAccounts,
      });

      const globalAnalysis = analyzeAfterFetch
        ? await matchAnalyzer.analyzeGlobalStats()
        : {
            ok: true as const,
            matchesAnalyzed: 0,
            recommendationStatsCount: 0,
            itemStatsCount: 0,
            matchupStatsCount: 0,
          };

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
            failedAccounts,
            retryScheduledAccounts,
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
      await markAnalyticsJobFailed(error, {
        currentJob: "update-stats",
        metadata: {
          stage: "fetching-matches",
        },
      });
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

function isRetryableRiotError(error: unknown): boolean {
  return error instanceof RiotApiError && (
    error.status === null ||
    RETRYABLE_ACCOUNT_ERROR_STATUSES.has(error.status)
  );
}

function shouldSkipAccount(lastFetchedAt: Date | null): boolean {
  if (!lastFetchedAt) {
    return false;
  }

  return Date.now() - lastFetchedAt.getTime() < backendConfig.trackedAccountCooldownMinutes * 60_000;
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

async function saveUpdateStatsProgress(options: {
  jobLogId: string;
  startedAt: Date;
  accountsVisited: number;
  totalAccounts: number;
  accountsProcessed: number;
  fetchedMatches: number;
  skippedMatches: number;
  failedAccounts: number;
  retryScheduledAccounts: number;
}) {
  await prisma.fetchJobLog.update({
    where: {
      id: options.jobLogId,
    },
    data: {
      durationMs: Date.now() - options.startedAt.getTime(),
      recordsRead: options.accountsVisited,
      recordsSaved: options.fetchedMatches,
      metadata: JSON.stringify({
        stage: "fetch-new-matches",
        progress: calculateProgress(options.accountsVisited, options.totalAccounts),
        processedMatches: options.fetchedMatches,
        accountsVisited: options.accountsVisited,
        totalAccounts: options.totalAccounts,
        accountsProcessed: options.accountsProcessed,
        fetchedMatches: options.fetchedMatches,
        skippedMatches: options.skippedMatches,
        failedAccounts: options.failedAccounts,
        retryScheduledAccounts: options.retryScheduledAccounts,
      }),
    },
  });

  await setAnalyticsJobState({
    status: "running",
    currentStage: "fetching-matches",
    currentJob: "update-stats",
    progress: calculateProgress(options.accountsVisited, options.totalAccounts),
    processedMatches: options.fetchedMatches,
    metadata: {
      accountsVisited: options.accountsVisited,
      totalAccounts: options.totalAccounts,
      accountsProcessed: options.accountsProcessed,
      fetchedMatches: options.fetchedMatches,
      skippedMatches: options.skippedMatches,
      failedAccounts: options.failedAccounts,
      retryScheduledAccounts: options.retryScheduledAccounts,
    },
  });
}

function calculateProgress(processed: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.min(99, Math.max(0, Math.floor((processed / total) * 100)));
}

function compareTrackedAccountPriority(
  left: { rankedTier: string | null; updatedAt: Date },
  right: { rankedTier: string | null; updatedAt: Date },
) {
  const tierDelta = rankedTierPriority(left.rankedTier) - rankedTierPriority(right.rankedTier);
  if (tierDelta !== 0) {
    return tierDelta;
  }

  return right.updatedAt.getTime() - left.updatedAt.getTime();
}

function rankedTierPriority(tier: string | null) {
  switch ((tier ?? "").toUpperCase()) {
    case "CHALLENGER":
      return 0;
    case "GRANDMASTER":
      return 10;
    case "MASTER":
      return 20;
    case "DIAMOND":
    case "DIAMOND_PLUS":
      return 30;
    default:
      return 50;
  }
}
