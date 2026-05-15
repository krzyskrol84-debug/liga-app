import { prisma } from "../lib/prisma.js";
import { logInfo } from "../lib/logger.js";
import {
  RiotApiClient,
  RiotApiError,
  type MatchDto,
  type MatchParticipantDto,
  type PlatformRegion,
  type RoutingRegion,
} from "../riot/RiotApiClient.js";
import { serializeCompactMatchPayload } from "../lib/matchPayload.js";

const INSERT_BATCH_SIZE = 50;
const FETCH_SUMMARY_INTERVAL = 50;
const MATCH_DETAIL_WORKERS = 4;
const CLAIM_BATCH_SIZE = 25;
const QUEUE_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_QUEUE_ATTEMPTS = 8;

export type FetchMatchesJobInput = {
  gameName: string;
  tagLine: string;
  platformRegion: PlatformRegion;
  routingRegion: RoutingRegion;
  count: number;
};

export type FetchMatchesJobResult = {
  ok: true;
  puuid: string;
  requestedCount: number;
  matchIdsCount: number;
  skippedExisting: number;
  fetchedNewMatches: number;
  savedMatches: number;
};

export type TrackedAccountLike = {
  id: string;
  gameName: string;
  tagLine: string;
  puuid: string;
  platformRegion: string;
  routingRegion: string;
  rankedTier?: string | null;
  lastFetchedAt: Date | null;
};

export class FetchMatchesJob {
  private readonly riotApiClient: RiotApiClient;

  constructor(riotApiClient = new RiotApiClient()) {
    this.riotApiClient = riotApiClient;
  }

  async run(input: FetchMatchesJobInput): Promise<FetchMatchesJobResult> {
    const startedAt = new Date();
    const target = `${input.gameName}#${input.tagLine}`;
    const jobLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "fetch-matches",
        status: "running",
        target,
        startedAt,
        metadata: JSON.stringify({
          platformRegion: input.platformRegion,
          routingRegion: input.routingRegion,
          count: input.count,
        }),
      },
    });

    try {
      const account = await this.riotApiClient.getAccountByRiotId(
        input.gameName,
        input.tagLine,
        input.platformRegion,
      );
      const fetchResult = await this.fetchAndStoreMatchesForAccount(
        {
          id: "ad-hoc",
          gameName: input.gameName,
          tagLine: input.tagLine,
          puuid: account.puuid,
          platformRegion: input.platformRegion,
          routingRegion: input.routingRegion,
          lastFetchedAt: null,
        },
        input.count,
      );

      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: {
          id: jobLog.id,
        },
        data: {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          recordsRead: fetchResult.matchIdsCount,
          recordsSaved: fetchResult.savedMatches,
          metadata: JSON.stringify({
            platformRegion: input.platformRegion,
            routingRegion: input.routingRegion,
            requestedCount: input.count,
            puuid: account.puuid,
            matchIdsCount: fetchResult.matchIdsCount,
            skippedExisting: fetchResult.skippedExisting,
            fetchedNewMatches: fetchResult.fetchedNewMatches,
            savedMatches: fetchResult.savedMatches,
          }),
        },
      });

      logInfo("Fetch matches job completed.", {
        target,
        requestedCount: input.count,
        matchIdsCount: fetchResult.matchIdsCount,
        skippedExisting: fetchResult.skippedExisting,
        fetchedNewMatches: fetchResult.fetchedNewMatches,
        savedMatches: fetchResult.savedMatches,
      });

      return {
        ok: true,
        puuid: account.puuid,
        requestedCount: input.count,
        matchIdsCount: fetchResult.matchIdsCount,
        skippedExisting: fetchResult.skippedExisting,
        fetchedNewMatches: fetchResult.fetchedNewMatches,
        savedMatches: fetchResult.savedMatches,
      };
    } catch (error) {
      const finishedAt = new Date();
      const message = getSafeErrorMessage(error);

      await prisma.fetchJobLog.update({
        where: {
          id: jobLog.id,
        },
        data: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: message,
        },
      });

      throw error;
    }
  }

  async fetchAndStoreMatchesForAccount(
    trackedAccount: TrackedAccountLike,
    count: number,
  ): Promise<FetchMatchesJobResult> {
    const routingRegion = trackedAccount.routingRegion as RoutingRegion;
    const platformRegion = trackedAccount.platformRegion as PlatformRegion;
    const puuid = trackedAccount.puuid;
    const startTime = trackedAccount.lastFetchedAt
      ? Math.max(0, Math.floor(trackedAccount.lastFetchedAt.getTime() / 1000) - 600)
      : undefined;
    const matchIds = await this.riotApiClient.getMatchIdsByPuuid(puuid, routingRegion, {
      count,
      startTime,
    });
    const uniqueMatchIds = [...new Set(matchIds)];
    const existingMatches = await prisma.matchRecord.findMany({
      where: {
        riotMatchId: {
          in: uniqueMatchIds,
        },
      },
      select: {
        riotMatchId: true,
      },
    });
    const existingIds = new Set(existingMatches.map((record) => record.riotMatchId));
    const missingMatchIds = uniqueMatchIds.filter((matchId) => !existingIds.has(matchId));
    const priority = getFetchPriority(trackedAccount);

    let skippedExisting = uniqueMatchIds.length - missingMatchIds.length;
    await enqueueMatchIds({
      matchIds: missingMatchIds,
      puuid,
      platformRegion,
      routingRegion,
      priority,
    });
    const queueResult = await processPersistentMatchQueue({
      puuid,
      routingRegion,
      riotApiClient: this.riotApiClient,
    });

    return {
      ok: true,
      puuid,
      requestedCount: count,
      matchIdsCount: uniqueMatchIds.length,
      skippedExisting,
      fetchedNewMatches: queueResult.fetchedNewMatches,
      savedMatches: queueResult.savedMatches,
    };
  }
}

export async function getMatchFetchQueueMetrics() {
  const [pending, processing, failed, completed] = await Promise.all([
    prisma.riotMatchFetchQueue.count({ where: { status: "pending" } }),
    prisma.riotMatchFetchQueue.count({ where: { status: "processing" } }),
    prisma.riotMatchFetchQueue.count({ where: { status: "failed" } }),
    prisma.riotMatchFetchQueue.count({ where: { status: "completed" } }),
  ]);

  const recentCompleted = await prisma.riotMatchFetchQueue.count({
    where: {
      status: "completed",
      fetchedAt: {
        gte: new Date(Date.now() - 60_000),
      },
    },
  });

  return {
    matchFetchQueueSize: pending + processing,
    matchFetchQueuePending: pending,
    matchFetchQueueProcessing: processing,
    matchFetchQueueFailed: failed,
    matchFetchQueueCompleted: completed,
    matchesPerMinute: recentCompleted,
  };
}

async function enqueueMatchIds(options: {
  matchIds: string[];
  puuid: string;
  platformRegion: PlatformRegion;
  routingRegion: RoutingRegion;
  priority: number;
}) {
  if (options.matchIds.length === 0) {
    return;
  }

  await prisma.riotMatchFetchQueue.createMany({
    data: options.matchIds.map((riotMatchId) => ({
      riotMatchId,
      puuid: options.puuid,
      platformRegion: options.platformRegion,
      routingRegion: options.routingRegion,
      priority: options.priority,
      status: "pending",
      nextAttemptAt: new Date(),
    })),
    skipDuplicates: true,
  });
}

async function processPersistentMatchQueue(options: {
  puuid: string;
  routingRegion: RoutingRegion;
  riotApiClient: RiotApiClient;
}) {
  const workerResults = await Promise.all(
    Array.from({ length: MATCH_DETAIL_WORKERS }, () => processMatchQueueWorker(options)),
  );

  return workerResults.reduce(
    (accumulator, result) => ({
      fetchedNewMatches: accumulator.fetchedNewMatches + result.fetchedNewMatches,
      savedMatches: accumulator.savedMatches + result.savedMatches,
    }),
    { fetchedNewMatches: 0, savedMatches: 0 },
  );
}

async function processMatchQueueWorker(options: {
  puuid: string;
  routingRegion: RoutingRegion;
  riotApiClient: RiotApiClient;
}) {
  let fetchedNewMatches = 0;
  let savedMatches = 0;
  const rowsToInsert: MatchRecordInsertRow[] = [];

  while (true) {
    const items = await claimMatchQueueItems(options.puuid);
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      try {
        const existing = await prisma.matchRecord.findUnique({
          where: {
            riotMatchId: item.riotMatchId,
          },
          select: {
            id: true,
          },
        });

        if (existing) {
          await markQueueItemCompleted(item.id);
          continue;
        }

        const match = await options.riotApiClient.getMatchById(
          item.riotMatchId,
          item.routingRegion as RoutingRegion,
        );
        fetchedNewMatches += 1;
        const participant = findParticipantByPuuid(match, item.puuid);

        if (participant) {
          rowsToInsert.push(buildMatchRecordRow(item.riotMatchId, item.puuid, match, participant));
        }

        await markQueueItemCompleted(item.id);

        if (fetchedNewMatches % FETCH_SUMMARY_INTERVAL === 0) {
          logInfo("Match fetch progress summary.", {
            puuid: options.puuid,
            fetchedNewMatches,
            queuedForInsert: rowsToInsert.length,
            queueMetrics: await getMatchFetchQueueMetrics(),
            riotMetrics: RiotApiClient.getMetrics(),
          });
        }

        if (rowsToInsert.length >= INSERT_BATCH_SIZE) {
          savedMatches += await flushMatchRows(rowsToInsert);
        }
      } catch (error) {
        await markQueueItemFailed(item.id, error);
      }
    }
  }

  savedMatches += await flushMatchRows(rowsToInsert);
  return { fetchedNewMatches, savedMatches };
}

async function claimMatchQueueItems(puuid: string) {
  const staleLockBefore = new Date(Date.now() - QUEUE_LOCK_TIMEOUT_MS);
  const items = await prisma.riotMatchFetchQueue.findMany({
    where: {
      puuid,
      OR: [
        {
          status: "pending",
          nextAttemptAt: {
            lte: new Date(),
          },
        },
        {
          status: "processing",
          lockedAt: {
            lt: staleLockBefore,
          },
        },
      ],
    },
    orderBy: [
      { priority: "asc" },
      { nextAttemptAt: "asc" },
      { createdAt: "asc" },
    ],
    take: CLAIM_BATCH_SIZE,
  });

  const claimed = [];
  for (const item of items) {
    const result = await prisma.riotMatchFetchQueue.updateMany({
      where: {
        id: item.id,
        status: item.status,
      },
      data: {
        status: "processing",
        lockedAt: new Date(),
        attempts: {
          increment: 1,
        },
      },
    });

    if (result.count === 1) {
      claimed.push(item);
    }
  }

  return claimed;
}

async function markQueueItemCompleted(id: string) {
  await prisma.riotMatchFetchQueue.update({
    where: { id },
    data: {
      status: "completed",
      fetchedAt: new Date(),
      lockedAt: null,
      lastError: null,
    },
  });
}

async function markQueueItemFailed(id: string, error: unknown) {
  const current = await prisma.riotMatchFetchQueue.findUnique({
    where: { id },
    select: {
      attempts: true,
    },
  });
  const attempts = current?.attempts ?? 1;
  const retryable = isRetryableRiotError(error);
  const shouldRetry = retryable && attempts < MAX_QUEUE_ATTEMPTS;
  const delayMs = error instanceof RiotApiError && error.status === 429
    ? 60_000
    : getQueueBackoffMs(attempts);

  await prisma.riotMatchFetchQueue.update({
    where: { id },
    data: {
      status: shouldRetry ? "pending" : "failed",
      lockedAt: null,
      nextAttemptAt: shouldRetry ? new Date(Date.now() + delayMs) : new Date(),
      lastError: getSafeErrorMessage(error),
    },
  });
}

type MatchRecordInsertRow = {
  riotMatchId: string;
  puuid: string;
  patch: string | null;
  queueId: number | null;
  championId: number;
  role: string | null;
  win: boolean;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  durationSeconds: number | null;
  playedAt: Date | null;
  rawPayload: string | null;
  compactPayload: string;
  payloadFormat: string;
  compactedAt: Date;
  fetchedAt: Date;
};

function buildMatchRecordRow(
  matchId: string,
  puuid: string,
  match: MatchDto,
  participant: MatchParticipantDto,
): MatchRecordInsertRow {
  return {
    riotMatchId: matchId,
    puuid,
    patch: extractPatch(match),
    queueId: match.info?.queueId ?? null,
    championId: participant.championId,
    role: participant.teamPosition ?? null,
    win: participant.win,
    kills: participant.kills ?? null,
    deaths: participant.deaths ?? null,
    assists: participant.assists ?? null,
    durationSeconds: match.info?.gameDuration ?? null,
    playedAt: extractPlayedAt(match),
    rawPayload: null,
    compactPayload: serializeCompactMatchPayload(matchId, match),
    payloadFormat: "compact-json-v1",
    compactedAt: new Date(),
    fetchedAt: new Date(),
  };
}

async function flushMatchRows(rowsToInsert: MatchRecordInsertRow[]) {
  if (rowsToInsert.length === 0) {
    return 0;
  }

  const rows = rowsToInsert.splice(0, rowsToInsert.length);
  const result = await prisma.matchRecord.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

function isRetryableRiotError(error: unknown): boolean {
  return error instanceof RiotApiError && (
    error.status === null ||
    error.status === 429 ||
    error.status === 500 ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504
  );
}

function getQueueBackoffMs(attempts: number) {
  return Math.min(15 * 60_000, 1_000 * 2 ** Math.min(attempts, 8));
}

function getFetchPriority(trackedAccount: TrackedAccountLike) {
  const tierSource = (trackedAccount.rankedTier ?? "").toUpperCase();
  if (tierSource.includes("CHALLENGER")) return 0;
  if (tierSource.includes("GRANDMASTER")) return 10;
  if (tierSource.includes("MASTER")) return 20;
  if (tierSource.includes("DIAMOND")) return 30;
  return 50;
}

function findParticipantByPuuid(match: MatchDto, puuid: string): MatchParticipantDto | null {
  return match.info?.participants?.find((participant) => participant.puuid === puuid) ?? null;
}

function extractPatch(match: MatchDto): string | null {
  const version = match.info?.gameVersion;
  if (!version) {
    return null;
  }

  const parts = version.split(".");
  if (parts.length < 2) {
    return version;
  }

  return `${parts[0]}.${parts[1]}`;
}

function extractPlayedAt(match: MatchDto): Date | null {
  const timestamp = match.info?.gameEndTimestamp ?? match.info?.gameCreation;
  if (!timestamp || !Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp);
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

export const fetchMatchesJob = new FetchMatchesJob();
