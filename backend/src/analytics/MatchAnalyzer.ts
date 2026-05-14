import { prisma } from "../lib/prisma.js";
import { clearAnalyticsCache } from "../lib/analyticsCache.js";
import { assertNoRunningJob } from "../lib/jobGuards.js";

const RECORD_BATCH_SIZE = 200;
const WRITE_BATCH_SIZE = 250;

type SupportedRole = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
type NormalizedRole = "top" | "jungle" | "middle" | "bottom" | "utility";
type ItemSetType = "starting" | "core" | "fourth" | "fifth" | "sixth";

type RiotStoredMatchPayload = {
  info?: {
    gameVersion?: string;
    participants?: RiotStoredParticipant[];
  };
};

type RiotStoredParticipant = {
  championId?: number;
  teamId?: number;
  teamPosition?: string;
  win?: boolean;
  summoner1Id?: number;
  summoner2Id?: number;
  perks?: {
    styles?: Array<{
      style?: number;
      selections?: Array<{
        perk?: number;
      }>;
    }>;
  };
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
};

type RecommendationAggregate = {
  patch: string;
  championId: number;
  role: NormalizedRole;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
  summonerSpellIds: [number, number];
  gamesCount: number;
  wins: number;
};

type ItemAggregate = {
  patch: string;
  championId: number;
  role: NormalizedRole;
  itemSetType: ItemSetType;
  itemIds: number[];
  gamesCount: number;
  wins: number;
};

type MatchupAggregate = {
  patch: string;
  championId: number;
  opponentChampionId: number;
  role: NormalizedRole;
  gamesCount: number;
  wins: number;
};

type ExtractedParticipant = {
  patch: string;
  championId: number;
  teamId: number;
  role: NormalizedRole;
  win: boolean;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
  summonerSpellIds: [number, number];
  itemSets: Array<{
    itemSetType: ItemSetType;
    itemIds: number[];
  }>;
};

export type AnalyzeMatchesResult = {
  ok: true;
  processedRecords: number;
  processedParticipants: number;
  recommendationStatsSaved: number;
  itemStatsSaved: number;
};

export type AnalyzeGlobalStatsResult = {
  ok: true;
  matchesAnalyzed: number;
  recommendationStatsCount: number;
  itemStatsCount: number;
  matchupStatsCount: number;
};

export class MatchAnalyzer {
  async analyzeSavedMatches(): Promise<AnalyzeMatchesResult> {
    const result = await this.analyzeGlobalStats();
    const processedParticipants = await countProcessedParticipants();

    return {
      ok: true,
      processedRecords: result.matchesAnalyzed,
      processedParticipants,
      recommendationStatsSaved: result.recommendationStatsCount,
      itemStatsSaved: result.itemStatsCount,
    };
  }

  async analyzeGlobalStats(): Promise<AnalyzeGlobalStatsResult> {
    await assertNoRunningJob("analyze-global-stats");
    const startedAt = new Date();
    const jobLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "analyze-global-stats",
        status: "running",
        target: "match-records",
        startedAt,
      },
    });

    try {
      const latestPatch = await resolveLatestPatch();
      if (!latestPatch) {
        await prisma.fetchJobLog.update({
          where: { id: jobLog.id },
          data: {
            status: "completed",
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            recordsRead: 0,
            recordsSaved: 0,
            metadata: JSON.stringify({
              matchesAnalyzed: 0,
              recommendationStatsCount: 0,
              itemStatsCount: 0,
              matchupStatsCount: 0,
              patches: [],
            }),
          },
        });

        clearAnalyticsCache();
        return {
          ok: true,
          matchesAnalyzed: 0,
          recommendationStatsCount: 0,
          itemStatsCount: 0,
          matchupStatsCount: 0,
        };
      }

      const recommendationAggregates = new Map<string, RecommendationAggregate>();
      const itemAggregates = new Map<string, ItemAggregate>();
      const matchupAggregates = new Map<string, MatchupAggregate>();
      let processedRecords = 0;
      let cursorId: string | undefined;

      while (true) {
        const records = await prisma.matchRecord.findMany({
          take: RECORD_BATCH_SIZE,
          ...(cursorId
            ? {
                skip: 1,
                cursor: {
                  id: cursorId,
                },
              }
            : {}),
          orderBy: {
            id: "asc",
          },
        });

        if (records.length === 0) {
          break;
        }

        for (const record of records) {
          const parsed = safeParseMatch(record.rawPayload);
          const participants = parsed?.info?.participants ?? [];
          const patch = record.patch ?? extractPatchFromVersion(parsed?.info?.gameVersion);

          if (patch !== latestPatch || participants.length === 0) {
            continue;
          }

          processedRecords += 1;

          const extractedParticipants = participants
            .map((participant) => extractParticipant(participant, patch))
            .filter((participant): participant is ExtractedParticipant => participant !== null);

          for (const participant of extractedParticipants) {
            accumulateRecommendationStats(recommendationAggregates, participant);
            accumulateItemStats(itemAggregates, participant);
          }

          accumulateMatchups(matchupAggregates, extractedParticipants);
        }

        cursorId = records.at(-1)?.id;
      }

      const source = "riot-api";
      const now = new Date();

      const recommendationStatsRows = [...recommendationAggregates.values()].map((entry) => ({
        patch: entry.patch,
        championId: entry.championId,
        role: entry.role,
        label: "riot-api",
        primaryStyleId: entry.primaryStyleId,
        subStyleId: entry.subStyleId,
        selectedPerkIds: JSON.stringify(entry.selectedPerkIds),
        summonerSpellIds: JSON.stringify(entry.summonerSpellIds),
        wins: entry.wins,
        winRate: calculateWinRate(entry.wins, entry.gamesCount),
        pickRate: 0,
        gamesCount: entry.gamesCount,
        source,
        fetchedAt: now,
      }));

      const itemStatsRows = [...itemAggregates.values()].map((entry) => ({
        patch: entry.patch,
        championId: entry.championId,
        role: entry.role,
        itemSetType: entry.itemSetType,
        itemSetKey: entry.itemIds.join("-"),
        itemSetIds: JSON.stringify(entry.itemIds),
        wins: entry.wins,
        winRate: calculateWinRate(entry.wins, entry.gamesCount),
        pickRate: 0,
        gamesCount: entry.gamesCount,
        matches: entry.gamesCount,
        source,
        fetchedAt: now,
      }));

      const matchupStatsRows = [...matchupAggregates.values()].map((entry) => ({
        patch: entry.patch,
        championId: entry.championId,
        opponentChampionId: entry.opponentChampionId,
        role: entry.role,
        wins: entry.wins,
        winRate: calculateWinRate(entry.wins, entry.gamesCount),
        gamesCount: entry.gamesCount,
        source,
        fetchedAt: now,
      }));

      await prisma.$transaction([
        prisma.recommendationStats.deleteMany({
          where: {
            source,
          },
        }),
        prisma.itemStats.deleteMany({
          where: {
            source,
          },
        }),
        prisma.matchupStats.deleteMany({
          where: {
            source,
          },
        }),
      ]);

      for (const rows of chunk(recommendationStatsRows, WRITE_BATCH_SIZE)) {
        await prisma.$transaction([
          prisma.recommendationStats.createMany({
            data: rows,
          }),
        ]);
      }

      for (const rows of chunk(itemStatsRows, WRITE_BATCH_SIZE)) {
        await prisma.$transaction([
          prisma.itemStats.createMany({
            data: rows,
          }),
        ]);
      }

      for (const rows of chunk(matchupStatsRows, WRITE_BATCH_SIZE)) {
        await prisma.$transaction([
          prisma.matchupStats.createMany({
            data: rows,
          }),
        ]);
      }

      recommendationAggregates.clear();
      itemAggregates.clear();
      matchupAggregates.clear();

      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: { id: jobLog.id },
        data: {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          recordsRead: processedRecords,
          recordsSaved:
            recommendationStatsRows.length + itemStatsRows.length + matchupStatsRows.length,
          metadata: JSON.stringify({
            matchesAnalyzed: processedRecords,
            recommendationStatsCount: recommendationStatsRows.length,
            itemStatsCount: itemStatsRows.length,
            matchupStatsCount: matchupStatsRows.length,
            patches: [latestPatch],
          }),
        },
      });

      clearAnalyticsCache();

      return {
        ok: true,
        matchesAnalyzed: processedRecords,
        recommendationStatsCount: recommendationStatsRows.length,
        itemStatsCount: itemStatsRows.length,
        matchupStatsCount: matchupStatsRows.length,
      };
    } catch (error) {
      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: { id: jobLog.id },
        data: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: getSafeErrorMessage(error),
        },
      });
      clearAnalyticsCache();
      throw error;
    }
  }
}

function safeParseMatch(rawPayload: string): RiotStoredMatchPayload | null {
  try {
    return JSON.parse(rawPayload) as RiotStoredMatchPayload;
  } catch {
    return null;
  }
}

function extractParticipant(
  participant: RiotStoredParticipant,
  patch: string,
): ExtractedParticipant | null {
  const championId = participant.championId;
  const teamId = participant.teamId;
  const role = normalizeRole(participant.teamPosition);
  const primaryStyleId = participant.perks?.styles?.[0]?.style;
  const subStyleId = participant.perks?.styles?.[1]?.style;
  const summoner1Id = participant.summoner1Id;
  const summoner2Id = participant.summoner2Id;
  const selectedPerkIds = collectSelectedPerkIds(participant);

  if (
    !championId ||
    !teamId ||
    !role ||
    !primaryStyleId ||
    !subStyleId ||
    !summoner1Id ||
    !summoner2Id ||
    selectedPerkIds.length === 0
  ) {
    return null;
  }

  return {
    patch,
    championId,
    teamId,
    role,
    win: Boolean(participant.win),
    primaryStyleId,
    subStyleId,
    selectedPerkIds,
    summonerSpellIds: normalizeSummonerSpellPair(summoner1Id, summoner2Id),
    itemSets: collectItemSets(participant),
  };
}

function collectSelectedPerkIds(participant: RiotStoredParticipant): number[] {
  const perkIds =
    participant.perks?.styles
      ?.flatMap((style) => style.selections ?? [])
      .map((selection) => selection.perk)
      .filter((perkId): perkId is number => typeof perkId === "number" && Number.isInteger(perkId) && perkId > 0) ?? [];

  return [...new Set(perkIds)];
}

function collectItemSets(participant: RiotStoredParticipant): ExtractedParticipant["itemSets"] {
  const finalItems = [
    participant.item0 ?? 0,
    participant.item1 ?? 0,
    participant.item2 ?? 0,
    participant.item3 ?? 0,
    participant.item4 ?? 0,
    participant.item5 ?? 0,
  ].filter((itemId): itemId is number => Number.isInteger(itemId) && itemId > 0);

  const itemSets: ExtractedParticipant["itemSets"] = [];

  if (finalItems.length >= 1) {
    itemSets.push({
      itemSetType: "starting",
      itemIds: finalItems.slice(0, Math.min(2, finalItems.length)),
    });
  }

  if (finalItems.length >= 3) {
    itemSets.push({
      itemSetType: "core",
      itemIds: finalItems.slice(0, 3),
    });
  }

  if (finalItems.length >= 4) {
    itemSets.push({
      itemSetType: "fourth",
      itemIds: [finalItems[3]],
    });
  }

  if (finalItems.length >= 5) {
    itemSets.push({
      itemSetType: "fifth",
      itemIds: [finalItems[4]],
    });
  }

  if (finalItems.length >= 6) {
    itemSets.push({
      itemSetType: "sixth",
      itemIds: [finalItems[5]],
    });
  }

  return itemSets;
}

function normalizeRole(teamPosition: string | undefined): NormalizedRole | null {
  const role = (teamPosition ?? "").toUpperCase() as SupportedRole | "";

  switch (role) {
    case "TOP":
      return "top";
    case "JUNGLE":
      return "jungle";
    case "MIDDLE":
      return "middle";
    case "BOTTOM":
      return "bottom";
    case "UTILITY":
      return "utility";
    default:
      return null;
  }
}

function normalizeSummonerSpellPair(spell1Id: number, spell2Id: number): [number, number] {
  return spell1Id <= spell2Id ? [spell1Id, spell2Id] : [spell2Id, spell1Id];
}

function extractPatchFromVersion(version: string | undefined): string | null {
  if (!version) {
    return null;
  }

  const parts = version.split(".");
  if (parts.length < 2) {
    return version;
  }

  return `${parts[0]}.${parts[1]}`;
}

function accumulateRecommendationStats(
  aggregates: Map<string, RecommendationAggregate>,
  participant: ExtractedParticipant,
) {
  const key = [
    participant.patch,
    participant.championId,
    participant.role,
    participant.primaryStyleId,
    participant.subStyleId,
    participant.selectedPerkIds.join("-"),
    participant.summonerSpellIds.join("-"),
  ].join(":");

  const current = aggregates.get(key) ?? {
    patch: participant.patch,
    championId: participant.championId,
    role: participant.role,
    primaryStyleId: participant.primaryStyleId,
    subStyleId: participant.subStyleId,
    selectedPerkIds: participant.selectedPerkIds,
    summonerSpellIds: participant.summonerSpellIds,
    gamesCount: 0,
    wins: 0,
  };

  current.gamesCount += 1;
  if (participant.win) {
    current.wins += 1;
  }

  aggregates.set(key, current);
}

function accumulateItemStats(
  aggregates: Map<string, ItemAggregate>,
  participant: ExtractedParticipant,
) {
  for (const itemSet of participant.itemSets) {
    const key = [
      participant.patch,
      participant.championId,
      participant.role,
      itemSet.itemSetType,
      itemSet.itemIds.join("-"),
    ].join(":");

    const current = aggregates.get(key) ?? {
      patch: participant.patch,
      championId: participant.championId,
      role: participant.role,
      itemSetType: itemSet.itemSetType,
      itemIds: itemSet.itemIds,
      gamesCount: 0,
      wins: 0,
    };

    current.gamesCount += 1;
    if (participant.win) {
      current.wins += 1;
    }

    aggregates.set(key, current);
  }
}

function accumulateMatchups(
  aggregates: Map<string, MatchupAggregate>,
  participants: ExtractedParticipant[],
) {
  const roleBuckets = new Map<NormalizedRole, ExtractedParticipant[]>();

  for (const participant of participants) {
    const bucket = roleBuckets.get(participant.role) ?? [];
    bucket.push(participant);
    roleBuckets.set(participant.role, bucket);
  }

  for (const [role, roleParticipants] of roleBuckets.entries()) {
    if (roleParticipants.length < 2) {
      continue;
    }

    for (const participant of roleParticipants) {
      const opponent = roleParticipants.find(
        (candidate) =>
          candidate.teamId !== participant.teamId &&
          candidate.championId !== participant.championId,
      );

      if (!opponent) {
        continue;
      }

      const key = [
        participant.patch,
        participant.championId,
        opponent.championId,
        role,
      ].join(":");

      const current = aggregates.get(key) ?? {
        patch: participant.patch,
        championId: participant.championId,
        opponentChampionId: opponent.championId,
        role,
        gamesCount: 0,
        wins: 0,
      };

      current.gamesCount += 1;
      if (participant.win) {
        current.wins += 1;
      }

      aggregates.set(key, current);
    }
  }
}

function calculateWinRate(wins: number, gamesCount: number): number {
  if (gamesCount <= 0) {
    return 0;
  }

  return Number(((wins / gamesCount) * 100).toFixed(2));
}

async function countProcessedParticipants() {
  const latestPatch = await resolveLatestPatch();
  if (!latestPatch) {
    return 0;
  }

  const records = await prisma.matchRecord.findMany({
    select: {
      rawPayload: true,
      patch: true,
    },
    where: {
      patch: latestPatch,
    },
  });

  let count = 0;
  for (const record of records) {
    const parsed = safeParseMatch(record.rawPayload);
    const patch = record.patch ?? extractPatchFromVersion(parsed?.info?.gameVersion);
    if (!patch) {
      continue;
    }

    for (const participant of parsed?.info?.participants ?? []) {
      if (extractParticipant(participant, patch)) {
        count += 1;
      }
    }
  }

  return count;
}

async function resolveLatestPatch() {
  const records = await prisma.matchRecord.findMany({
    select: {
      patch: true,
    },
    where: {
      patch: {
        not: null,
      },
    },
  });

  let latestPatch: string | null = null;
  for (const record of records) {
    const patch = record.patch;
    if (!patch) {
      continue;
    }

    if (!latestPatch || comparePatchVersions(patch, latestPatch) > 0) {
      latestPatch = patch;
    }
  }

  return latestPatch;
}

function comparePatchVersions(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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

export const matchAnalyzer = new MatchAnalyzer();
