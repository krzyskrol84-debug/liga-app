import { prisma } from "../lib/prisma.js";
import { assertNoRunningJob } from "../lib/jobGuards.js";
import {
  RiotApiClient,
  RiotApiError,
  type LeagueEntryDto,
  type PlatformRegion,
  type RoutingRegion,
} from "../riot/RiotApiClient.js";
import { logWarn } from "../lib/logger.js";

const BETWEEN_ENTRIES_DELAY_MS = 250;
const DIAMOND_DIVISIONS = ["I", "II", "III", "IV"] as const;
const MAX_DIAMOND_PAGES_PER_DIVISION = 10;

export type RankedQueue = "RANKED_SOLO_5x5";
export type RankedSeedTier = "CHALLENGER" | "GRANDMASTER" | "MASTER" | "DIAMOND_PLUS";

export type SeedRankedAccountsJobInput = {
  platformRegion: PlatformRegion;
  routingRegion: RoutingRegion;
  queue: RankedQueue;
  tiers: RankedSeedTier[];
  limit: number;
};

export type SeedRankedAccountsJobResult = {
  ok: true;
  fetchedEntries: number;
  addedAccounts: number;
  skippedDuplicates: number;
  failedAccounts: number;
};

export class SeedRankedAccountsJob {
  private readonly riotApiClient: RiotApiClient;

  constructor(riotApiClient = new RiotApiClient()) {
    this.riotApiClient = riotApiClient;
  }

  async run(input: SeedRankedAccountsJobInput): Promise<SeedRankedAccountsJobResult> {
    await assertNoRunningJob("seed-ranked-accounts");
    const startedAt = new Date();
    const jobLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "seed-ranked-accounts",
        status: "running",
        target: `${input.platformRegion}:${input.queue}`,
        startedAt,
        metadata: JSON.stringify({
          platformRegion: input.platformRegion,
          routingRegion: input.routingRegion,
          queue: input.queue,
          tiers: input.tiers,
          limit: input.limit,
        }),
      },
    });

    try {
      const entries = await this.fetchRankedEntries(input);
      const limitedEntries = entries.slice(0, input.limit);

      let addedAccounts = 0;
      let skippedDuplicates = 0;
      let failedAccounts = 0;

      for (const entry of limitedEntries) {
        try {
          const puuid = await this.resolveEntryPuuid(entry, input.platformRegion);

          const existing = await prisma.trackedAccount.findUnique({
            where: {
              puuid,
            },
          });

          if (existing) {
            skippedDuplicates += 1;
            continue;
          }

          const account = await this.riotApiClient.getAccountByPuuid(
            puuid,
            input.platformRegion,
          );

          await prisma.trackedAccount.create({
            data: {
              gameName: account.gameName,
              tagLine: account.tagLine,
              puuid: account.puuid,
              platformRegion: input.platformRegion,
              routingRegion: input.routingRegion,
            },
          });

          addedAccounts += 1;
          await sleep(BETWEEN_ENTRIES_DELAY_MS);
        } catch (error) {
          failedAccounts += 1;
          await prisma.fetchJobLog.create({
            data: {
              jobName: "seed-ranked-accounts.entry",
              status: "failed",
              target: entry.puuid ?? entry.summonerId ?? entry.summonerName ?? null,
              startedAt: new Date(),
              finishedAt: new Date(),
              errorMessage: getSafeErrorMessage(error),
              metadata: JSON.stringify({
                puuid: entry.puuid ?? null,
                summonerId: entry.summonerId,
                summonerName: entry.summonerName ?? null,
                tier: entry.tier ?? null,
                queue: entry.queueType ?? input.queue,
              }),
            },
          });
        }
      }

      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: {
          id: jobLog.id,
        },
        data: {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          recordsRead: limitedEntries.length,
          recordsSaved: addedAccounts,
          metadata: JSON.stringify({
            fetchedEntries: limitedEntries.length,
            addedAccounts,
            skippedDuplicates,
            failedAccounts,
          }),
        },
      });

      return {
        ok: true,
        fetchedEntries: limitedEntries.length,
        addedAccounts,
        skippedDuplicates,
        failedAccounts,
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

  private async fetchRankedEntries(input: SeedRankedAccountsJobInput): Promise<LeagueEntryDto[]> {
    const entries: LeagueEntryDto[] = [];

    for (const tier of input.tiers) {
      try {
        switch (tier) {
          case "CHALLENGER": {
            const result = await this.riotApiClient.getChallengerLeague(input.queue, input.platformRegion);
            entries.push(...(result.entries ?? []).map((entry) => ({ ...entry, tier: "CHALLENGER" })));
            break;
          }
          case "GRANDMASTER": {
            const result = await this.riotApiClient.getGrandmasterLeague(input.queue, input.platformRegion);
            entries.push(...(result.entries ?? []).map((entry) => ({ ...entry, tier: "GRANDMASTER" })));
            break;
          }
          case "MASTER": {
            const result = await this.riotApiClient.getMasterLeague(input.queue, input.platformRegion);
            entries.push(...(result.entries ?? []).map((entry) => ({ ...entry, tier: "MASTER" })));
            break;
          }
          case "DIAMOND_PLUS": {
            await this.fetchDiamondPlusEntries(input, entries);
            break;
          }
        }
      } catch (error) {
        await logRankedSeedFailure({
          tier,
          queue: input.queue,
          platformRegion: input.platformRegion,
          error,
        });
      }
    }

    const uniqueBySummonerId = new Map<string, LeagueEntryDto>();
    for (const entry of entries) {
      const key = entry.puuid ?? entry.summonerId;
      if (!key) {
        continue;
      }

      if (!uniqueBySummonerId.has(key)) {
        uniqueBySummonerId.set(key, entry);
      }
    }

    return [...uniqueBySummonerId.values()].sort(compareLeagueEntries);
  }

  private async fetchDiamondPlusEntries(
    input: SeedRankedAccountsJobInput,
    entries: LeagueEntryDto[],
  ) {
    for (const division of DIAMOND_DIVISIONS) {
      for (let page = 1; page <= MAX_DIAMOND_PAGES_PER_DIVISION; page += 1) {
        try {
          const result = await this.riotApiClient.getLeagueEntries(
            input.queue,
            "DIAMOND",
            division,
            input.platformRegion,
            page,
          );

          if (result.length === 0) {
            break;
          }

          entries.push(...result.map((entry) => ({ ...entry, tier: "DIAMOND" })));

          if (entries.length >= input.limit * 2) {
            break;
          }
        } catch (error) {
          await logRankedSeedFailure({
            tier: "DIAMOND_PLUS",
            queue: input.queue,
            platformRegion: input.platformRegion,
            division,
            page,
            error,
          });
          break;
        }
      }

      if (entries.length >= input.limit * 2) {
        break;
      }
    }
  }

  private async resolveEntryPuuid(entry: LeagueEntryDto, platformRegion: PlatformRegion): Promise<string> {
    if (entry.puuid && entry.puuid.trim().length > 0) {
      return entry.puuid;
    }

    if (!entry.summonerId || entry.summonerId.trim().length === 0) {
      throw new Error("Ranked entry is missing both puuid and summonerId.");
    }

    const summoner = await this.riotApiClient.getSummonerBySummonerId(
      entry.summonerId,
      platformRegion,
    );

    return summoner.puuid;
  }
}

function compareLeagueEntries(left: LeagueEntryDto, right: LeagueEntryDto) {
  const tierDelta = tierRank(left.tier) - tierRank(right.tier);
  if (tierDelta !== 0) {
    return tierDelta;
  }

  return (right.leaguePoints ?? 0) - (left.leaguePoints ?? 0);
}

function tierRank(tier: string | undefined) {
  switch ((tier ?? "").toUpperCase()) {
    case "CHALLENGER":
      return 0;
    case "GRANDMASTER":
      return 1;
    case "MASTER":
      return 2;
    case "DIAMOND":
      return 3;
    default:
      return 99;
  }
}

async function logRankedSeedFailure(options: {
  tier: RankedSeedTier;
  queue: RankedQueue;
  platformRegion: PlatformRegion;
  division?: string;
  page?: number;
  error: unknown;
}) {
  const retryable = isRetryableRiotError(options.error);
  logWarn("[riot] ranked seed source failed; continuing full refresh", {
    tier: options.tier,
    division: options.division ?? null,
    page: options.page ?? null,
    queue: options.queue,
    platformRegion: options.platformRegion,
    retryScheduled: retryable,
    error: getSafeErrorMessage(options.error),
  });

  await prisma.fetchJobLog.create({
    data: {
      jobName: "seed-ranked-accounts.source",
      status: retryable ? "retrying" : "failed",
      target: `${options.platformRegion}:${options.tier}:${options.division ?? "top"}:${options.page ?? 1}`,
      startedAt: new Date(),
      finishedAt: new Date(),
      errorMessage: getSafeErrorMessage(options.error),
      metadata: JSON.stringify({
        tier: options.tier,
        division: options.division ?? null,
        page: options.page ?? null,
        queue: options.queue,
        platformRegion: options.platformRegion,
        statusCode: options.error instanceof RiotApiError ? options.error.status : null,
        retryScheduled: retryable,
        retryReason: "next full-refresh run",
      }),
    },
  });
}

function isRetryableRiotError(error: unknown): boolean {
  return error instanceof RiotApiError && (
    error.status === null ||
    error.status === 429 ||
    error.status === 500 ||
    error.status === 502 ||
    error.status === 503
  );
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

export const seedRankedAccountsJob = new SeedRankedAccountsJob();
