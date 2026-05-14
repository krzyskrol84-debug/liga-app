import { prisma } from "../lib/prisma.js";
import { logInfo } from "../lib/logger.js";
import {
  RiotApiClient,
  type MatchDto,
  type MatchParticipantDto,
  type PlatformRegion,
  type RoutingRegion,
} from "../riot/RiotApiClient.js";

const MATCH_FETCH_BATCH_SIZE = 8;
const INSERT_BATCH_SIZE = 50;
const FETCH_SUMMARY_INTERVAL = 25;

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
    const puuid = trackedAccount.puuid;
    const matchIds = await this.riotApiClient.getMatchIdsByPuuid(puuid, routingRegion, {
      count,
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

    let skippedExisting = uniqueMatchIds.length - missingMatchIds.length;
    let fetchedNewMatches = 0;
    let savedMatches = 0;
    const rowsToInsert: Array<{
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
      rawPayload: string;
      fetchedAt: Date;
    }> = [];

    for (let index = 0; index < missingMatchIds.length; index += MATCH_FETCH_BATCH_SIZE) {
      const batchIds = missingMatchIds.slice(index, index + MATCH_FETCH_BATCH_SIZE);
      const matches = await Promise.all(
        batchIds.map(async (matchId) => ({
          matchId,
          match: await this.riotApiClient.getMatchById(matchId, routingRegion),
        })),
      );

      for (const { matchId, match } of matches) {
        fetchedNewMatches += 1;

        const participant = findParticipantByPuuid(match, puuid);
        if (!participant) {
          continue;
        }

        rowsToInsert.push({
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
          rawPayload: JSON.stringify(match),
          fetchedAt: new Date(),
        });

        if (fetchedNewMatches % FETCH_SUMMARY_INTERVAL === 0) {
          logInfo("Match fetch progress summary.", {
            puuid,
            fetchedNewMatches,
            queuedForInsert: rowsToInsert.length,
            requestedCount: count,
          });
        }
      }
    }

    for (let index = 0; index < rowsToInsert.length; index += INSERT_BATCH_SIZE) {
      const batchRows = rowsToInsert.slice(index, index + INSERT_BATCH_SIZE);
      if (batchRows.length === 0) {
        continue;
      }
      await prisma.matchRecord.createMany({
        data: batchRows,
      });
      savedMatches += batchRows.length;
    }

    return {
      ok: true,
      puuid,
      requestedCount: count,
      matchIdsCount: uniqueMatchIds.length,
      skippedExisting,
      fetchedNewMatches,
      savedMatches,
    };
  }
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
