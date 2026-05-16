import { backendConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { clearAnalyticsCache } from "../lib/analyticsCache.js";
import { assertNoRunningJob } from "../lib/jobGuards.js";
import { logInfo } from "../lib/logger.js";
import {
  failAnalyzerJobStatus,
  finishAnalyzerJobStatus,
  serializeAnalyzerJobStatus,
  startAnalyzerJobStatus,
  updateAnalyzerJobStatus,
} from "../lib/jobStatus.js";
import { markAnalyticsJobFailed, setAnalyticsJobState } from "../lib/analyticsJobState.js";
import { dataDragonService } from "../riot/DataDragonService.js";
import { parseStoredMatchPayload, type StoredParticipant } from "../lib/matchPayload.js";

const RECORD_CHUNK_SIZE = 750;
const WRITE_BATCH_SIZE = 250;

type SupportedRole = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
type NormalizedRole = "top" | "jungle" | "middle" | "bottom" | "utility";
type ItemSetType = "starting" | "core" | "fourth" | "fifth" | "sixth";

type RiotStoredParticipant = StoredParticipant;

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
  teamId: number | null;
  opponentChampionId: number | null;
  role: NormalizedRole;
  win: boolean;
  recommendation: {
    primaryStyleId: number;
    subStyleId: number;
    selectedPerkIds: number[];
    summonerSpellIds: [number, number];
  } | null;
  itemSets: Array<{
    itemSetType: ItemSetType;
    itemIds: number[];
  }>;
};

type MatchRecordForAnalysis = {
  id: string;
  riotMatchId: string;
  puuid: string;
  patch: string | null;
  rawPayload: string | null;
  compactPayload: string | null;
};

type ChunkAnalysisResult = {
  processedRecords: number;
  analyzedRecordIds: string[];
  participantsRead: number;
  participantsSkipped: number;
  recommendationAggregates: Map<string, RecommendationAggregate>;
  itemAggregates: Map<string, ItemAggregate>;
  matchupAggregates: Map<string, MatchupAggregate>;
  currentChampionId: number | null;
  currentRole: NormalizedRole | null;
  currentSummoner: string | null;
  currentMatchId: string | null;
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

export type AnalyzerSample = {
  totalMatchRecords: number;
  analyzedMatchesCount: number;
  compactedMatchesCount: number;
  samplePayloadType: "raw" | "compact" | null;
  participantCount: number;
  sampleChampionId: number | null;
  sampleRole: NormalizedRole | null;
  sampleWin: boolean | null;
  sampleRunes: number[];
  sampleItems: number[];
  canGenerateRecommendation: boolean;
  canGenerateItemStats: boolean;
  canGenerateMatchup: boolean;
  reasonIfFalse: string | null;
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
    startAnalyzerJobStatus("analyze-global-stats");
    await setAnalyticsJobState({
      status: "running",
      currentStage: "analyzing-stats",
      currentJob: "analyze-global-stats",
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
    });
    const jobLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "analyze-global-stats",
        status: "running",
        target: "match-records",
        startedAt,
        metadata: serializeAnalyzerJobStatus(updateAnalyzerJobStatus({ progress: 0 })),
      },
    });

    try {
      const latestPatch = await resolveLatestPatch();
      if (!latestPatch) {
        const finalStatus = finishAnalyzerJobStatus({
          progress: 100,
          processedMatches: 0,
          recommendationStatsAdded: 0,
          itemStatsAdded: 0,
          matchupStatsAdded: 0,
          currentChampion: null,
          currentRole: null,
        });
        await prisma.fetchJobLog.update({
          where: { id: jobLog.id },
          data: {
            status: "completed",
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            recordsRead: 0,
            recordsSaved: 0,
            metadata: JSON.stringify({
              jobStatus: finalStatus,
              matchesAnalyzed: 0,
              recommendationStatsCount: 0,
              itemStatsCount: 0,
              matchupStatsCount: 0,
              patches: [],
            }),
          },
        });

        clearAnalyticsCache();
        await setAnalyticsJobState({
          status: "completed",
          currentStage: "completed",
          currentJob: "analyze-global-stats",
          progress: 100,
          processedMatches: 0,
          recommendationStatsAdded: 0,
          itemStatsAdded: 0,
          matchupStatsAdded: 0,
          currentChampion: null,
          currentRole: null,
          errorMessage: null,
          finishedAt: new Date(),
          lastStatsUpdatedAt: new Date(),
        });
        return {
          ok: true,
          matchesAnalyzed: 0,
          recommendationStatsCount: 0,
          itemStatsCount: 0,
          matchupStatsCount: 0,
        };
      }

      const analysisRecordWhere = getAnalysisRecordWhere(latestPatch);
      const totalRecords = await prisma.matchRecord.count({
        where: analysisRecordWhere,
      });
      const championNameById = await getChampionNameMapping();
      const analyzerConcurrency = backendConfig.analyzerConcurrency;
      const recommendationAggregates = new Map<string, RecommendationAggregate>();
      const itemAggregates = new Map<string, ItemAggregate>();
      const matchupAggregates = new Map<string, MatchupAggregate>();
      let processedRecords = 0;
      const analyzedRecordIds: string[] = [];
      let participantsRead = 0;
      let participantsSkipped = 0;
      let cursorId: string | undefined;
      const pendingChunkAnalyses: Array<Promise<ChunkAnalysisResult>> = [];

      logInfo("[analyzer] starting parallel analysis", {
        patch: latestPatch,
        totalRecords,
        chunkSize: RECORD_CHUNK_SIZE,
        concurrency: analyzerConcurrency,
      });

      await saveAnalyzerProgress({
        jobLogId: jobLog.id,
        startedAt,
        processedRecords,
        totalRecords,
        recommendationStatsAdded: 0,
        itemStatsAdded: 0,
        matchupStatsAdded: 0,
        currentChampion: null,
        currentRole: null,
        currentSummoner: null,
        currentMatchId: null,
      });

      while (true) {
        const records = await prisma.matchRecord.findMany({
          take: RECORD_CHUNK_SIZE,
          where: analysisRecordWhere,
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
          select: {
            id: true,
            riotMatchId: true,
            puuid: true,
            patch: true,
            rawPayload: true,
            compactPayload: true,
          },
        });

        if (records.length === 0) {
          break;
        }

        pendingChunkAnalyses.push(Promise.resolve().then(() => analyzeRecordChunk(records, latestPatch)));

        cursorId = records.at(-1)?.id;

        if (pendingChunkAnalyses.length >= analyzerConcurrency) {
          const results = await Promise.all(pendingChunkAnalyses.splice(0, pendingChunkAnalyses.length));
          processedRecords = await mergeChunkResultsAndSaveProgress({
            results,
            processedRecords,
            totalRecords,
            recommendationAggregates,
            itemAggregates,
            matchupAggregates,
            championNameById,
            jobLogId: jobLog.id,
            startedAt,
          });
          participantsRead += results.reduce((sum, result) => sum + result.participantsRead, 0);
          participantsSkipped += results.reduce((sum, result) => sum + result.participantsSkipped, 0);
          analyzedRecordIds.push(...results.flatMap((result) => result.analyzedRecordIds));
        }
      }

      if (pendingChunkAnalyses.length > 0) {
        const results = await Promise.all(pendingChunkAnalyses.splice(0, pendingChunkAnalyses.length));
        processedRecords = await mergeChunkResultsAndSaveProgress({
          results,
          processedRecords,
          totalRecords,
          recommendationAggregates,
          itemAggregates,
          matchupAggregates,
          championNameById,
          jobLogId: jobLog.id,
          startedAt,
        });
        participantsRead += results.reduce((sum, result) => sum + result.participantsRead, 0);
        participantsSkipped += results.reduce((sum, result) => sum + result.participantsSkipped, 0);
        analyzedRecordIds.push(...results.flatMap((result) => result.analyzedRecordIds));
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

      logInfo("[analyzer] aggregate summary", {
        matchesRead: totalRecords,
        participantsRead,
        participantsSkipped,
        recommendationGroupsGenerated: recommendationStatsRows.length,
        itemGroupsGenerated: itemStatsRows.length,
        matchupGroupsGenerated: matchupStatsRows.length,
      });

      await saveAnalyzerProgress({
        jobLogId: jobLog.id,
        startedAt,
        processedRecords,
        totalRecords,
        recommendationStatsAdded: recommendationStatsRows.length,
        itemStatsAdded: itemStatsRows.length,
        matchupStatsAdded: matchupStatsRows.length,
        currentChampion: null,
        currentRole: null,
        currentSummoner: null,
        currentMatchId: null,
      });

      if (
        totalRecords > 0 &&
        recommendationStatsRows.length === 0 &&
        itemStatsRows.length === 0 &&
        matchupStatsRows.length === 0
      ) {
        throw new Error(
          "Analyzer read MatchRecord rows but generated zero stats; preserving existing stats instead of deleting them.",
        );
      }

      logInfo("[db] clearing old riot-api stats", {
        recommendationStats: recommendationStatsRows.length,
        itemStats: itemStatsRows.length,
        matchupStats: matchupStatsRows.length,
      });
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

      let statsInserted = 0;

      for (const rows of chunk(recommendationStatsRows, WRITE_BATCH_SIZE)) {
        logInfo("[db] saving recommendation stats batch", {
          rows: rows.length,
          champion: formatChampionName(rows[0]?.championId, championNameById),
          role: rows[0]?.role ?? null,
        });
        const [result] = await prisma.$transaction([
          prisma.recommendationStats.createMany({
            data: rows,
          }),
        ]);
        statsInserted += result.count;
      }

      for (const rows of chunk(itemStatsRows, WRITE_BATCH_SIZE)) {
        logInfo("[db] saving item stats batch", {
          rows: rows.length,
          champion: formatChampionName(rows[0]?.championId, championNameById),
          role: rows[0]?.role ?? null,
        });
        const [result] = await prisma.$transaction([
          prisma.itemStats.createMany({
            data: rows,
          }),
        ]);
        statsInserted += result.count;
      }

      for (const rows of chunk(matchupStatsRows, WRITE_BATCH_SIZE)) {
        logInfo("[db] saving matchup stats batch", {
          rows: rows.length,
          champion: formatChampionName(rows[0]?.championId, championNameById),
          role: rows[0]?.role ?? null,
        });
        const [result] = await prisma.$transaction([
          prisma.matchupStats.createMany({
            data: rows,
          }),
        ]);
        statsInserted += result.count;
      }

      logInfo("[db] saved analyzer stats", {
        saved: "stats",
        recommendationStatsAdded: recommendationStatsRows.length,
        itemStatsAdded: itemStatsRows.length,
        matchupStatsAdded: matchupStatsRows.length,
        matchesProcessed: processedRecords,
        statsInserted,
      });

      for (const ids of chunk(analyzedRecordIds, WRITE_BATCH_SIZE)) {
        await prisma.matchRecord.updateMany({
          where: {
            id: {
              in: ids,
            },
          },
          data: {
            analyzedAt: now,
          },
        });
      }

      recommendationAggregates.clear();
      itemAggregates.clear();
      matchupAggregates.clear();

      const finishedAt = new Date();
      const finalStatus = finishAnalyzerJobStatus({
        progress: 100,
        processedMatches: processedRecords,
        recommendationStatsAdded: recommendationStatsRows.length,
        itemStatsAdded: itemStatsRows.length,
        matchupStatsAdded: matchupStatsRows.length,
        currentChampion: null,
        currentRole: null,
      });
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
            jobStatus: finalStatus,
            matchesAnalyzed: processedRecords,
            recommendationStatsCount: recommendationStatsRows.length,
            itemStatsCount: itemStatsRows.length,
            matchupStatsCount: matchupStatsRows.length,
            patches: [latestPatch],
          }),
        },
      });

      clearAnalyticsCache();
      await setAnalyticsJobState({
        status: "completed",
        currentStage: "completed",
        currentJob: "analyze-global-stats",
        progress: 100,
        processedMatches: processedRecords,
        recommendationStatsAdded: recommendationStatsRows.length,
        itemStatsAdded: itemStatsRows.length,
        matchupStatsAdded: matchupStatsRows.length,
        currentChampion: null,
        currentRole: null,
        errorMessage: null,
        finishedAt,
        lastStatsUpdatedAt: finishedAt,
        metadata: {
          patches: [latestPatch],
        },
      });

      return {
        ok: true,
        matchesAnalyzed: processedRecords,
        recommendationStatsCount: recommendationStatsRows.length,
        itemStatsCount: itemStatsRows.length,
        matchupStatsCount: matchupStatsRows.length,
      };
    } catch (error) {
      const finishedAt = new Date();
      const failedStatus = failAnalyzerJobStatus();
      await prisma.fetchJobLog.update({
        where: { id: jobLog.id },
        data: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: getSafeErrorMessage(error),
          metadata: serializeAnalyzerJobStatus(failedStatus),
        },
      });
      await markAnalyticsJobFailed(error, {
        currentJob: "analyze-global-stats",
      });
      clearAnalyticsCache();
      throw error;
    }
  }

  async getAnalyzerSample(): Promise<AnalyzerSample> {
    const latestPatch = await resolveLatestPatch();
    const [totalMatchRecords, analyzedMatchesCount, compactedMatchesCount, firstRecord] = await Promise.all([
      prisma.matchRecord.count(),
      prisma.matchRecord.count({
        where: {
          analyzedAt: {
            not: null,
          },
        },
      }),
      prisma.matchRecord.count({
        where: {
          compactedAt: {
            not: null,
          },
        },
      }),
      prisma.matchRecord.findFirst({
        ...(latestPatch
          ? {
              where: getAnalysisRecordWhere(latestPatch),
            }
          : {}),
        orderBy: {
          createdAt: "asc",
        },
        select: {
          riotMatchId: true,
          patch: true,
          rawPayload: true,
          compactPayload: true,
        },
      }),
    ]);

    if (!firstRecord) {
      return {
        totalMatchRecords,
        analyzedMatchesCount,
        compactedMatchesCount,
        samplePayloadType: null,
        participantCount: 0,
        sampleChampionId: null,
        sampleRole: null,
        sampleWin: null,
        sampleRunes: [],
        sampleItems: [],
        canGenerateRecommendation: false,
        canGenerateItemStats: false,
        canGenerateMatchup: false,
        reasonIfFalse: "No MatchRecord rows found.",
      };
    }

    const parsed = safeParseMatch(firstRecord.rawPayload, firstRecord.compactPayload);
    const participants = parsed?.info?.participants ?? [];
    const patch = firstRecord.patch ?? extractPatchFromVersion(parsed?.info?.gameVersion);
    const extractedParticipants = patch
      ? participants
          .map((participant) => extractParticipant(participant, patch))
          .filter((participant): participant is ExtractedParticipant => participant !== null)
      : [];
    const sampleParticipant = participants[0];
    const sampleExtractedParticipant = patch && sampleParticipant
      ? extractParticipant(sampleParticipant, patch)
      : null;
    const sampleRole = normalizeParticipantRole(sampleParticipant);
    const sampleRunes = sampleParticipant ? collectSelectedPerkIds(sampleParticipant) : [];
    const sampleItems = sampleParticipant ? collectFinalItems(sampleParticipant) : [];
    const reasons: string[] = [];

    if (!parsed) reasons.push("rawPayload is not valid JSON.");
    if (!patch) reasons.push("patch is missing.");
    if (participants.length === 0) reasons.push("info.participants is empty.");
    if (sampleParticipant && !sampleRole) reasons.push("sample participant has no supported role.");
    if (sampleParticipant && sampleRunes.length === 0) reasons.push("sample participant has no selected runes.");
    if (sampleParticipant && sampleItems.length === 0) reasons.push("sample participant has no completed items.");
    if (!sampleExtractedParticipant) reasons.push("sample participant cannot be fully extracted.");
    if (sampleExtractedParticipant && !sampleExtractedParticipant.recommendation) {
      reasons.push("sample participant lacks complete recommendation fields.");
    }
    if (
      extractedParticipants.length > 0 &&
      !canBuildAnyMatchup(extractedParticipants)
    ) {
      reasons.push("sample match has no cross-team same-role pair for matchup stats.");
    }

    return {
      totalMatchRecords,
      analyzedMatchesCount,
      compactedMatchesCount,
      samplePayloadType: firstRecord.compactPayload ? "compact" : firstRecord.rawPayload ? "raw" : null,
      participantCount: participants.length,
      sampleChampionId: sampleParticipant?.championId ?? null,
      sampleRole,
      sampleWin: typeof sampleParticipant?.win === "boolean" ? sampleParticipant.win : null,
      sampleRunes,
      sampleItems,
      canGenerateRecommendation: Boolean(sampleExtractedParticipant?.recommendation),
      canGenerateItemStats: Boolean(sampleExtractedParticipant && sampleExtractedParticipant.itemSets.length > 0),
      canGenerateMatchup: canBuildAnyMatchup(extractedParticipants),
      reasonIfFalse: reasons.length > 0 ? reasons.join(" ") : null,
    };
  }
}

async function mergeChunkResultsAndSaveProgress(options: {
  results: ChunkAnalysisResult[];
  processedRecords: number;
  totalRecords: number;
  recommendationAggregates: Map<string, RecommendationAggregate>;
  itemAggregates: Map<string, ItemAggregate>;
  matchupAggregates: Map<string, MatchupAggregate>;
  championNameById: Map<number, string>;
  jobLogId: string;
  startedAt: Date;
}) {
  let processedRecords = options.processedRecords;

  for (const result of options.results) {
    mergeRecommendationAggregates(options.recommendationAggregates, result.recommendationAggregates);
    mergeItemAggregates(options.itemAggregates, result.itemAggregates);
    mergeMatchupAggregates(options.matchupAggregates, result.matchupAggregates);
    processedRecords += result.processedRecords;

    const currentChampion = result.currentChampionId
      ? options.championNameById.get(result.currentChampionId) ?? `Champion ${result.currentChampionId}`
      : null;

    await saveAnalyzerProgress({
      jobLogId: options.jobLogId,
      startedAt: options.startedAt,
      processedRecords,
      totalRecords: options.totalRecords,
      recommendationStatsAdded: options.recommendationAggregates.size,
      itemStatsAdded: options.itemAggregates.size,
      matchupStatsAdded: options.matchupAggregates.size,
      currentChampion,
      currentRole: result.currentRole,
      currentSummoner: result.currentSummoner,
      currentMatchId: result.currentMatchId,
    });

    if (result.currentMatchId) {
      logInfo("[riot]", {
        match: result.currentMatchId,
        status: "processed",
        currentSummoner: result.currentSummoner,
      });
    }
  }

  return processedRecords;
}

function analyzeRecordChunk(
  records: MatchRecordForAnalysis[],
  latestPatch: string,
): ChunkAnalysisResult {
  const recommendationAggregates = new Map<string, RecommendationAggregate>();
  const itemAggregates = new Map<string, ItemAggregate>();
  const matchupAggregates = new Map<string, MatchupAggregate>();
  let processedRecords = 0;
  const analyzedRecordIds: string[] = [];
  let participantsRead = 0;
  let participantsSkipped = 0;
  let currentChampionId: number | null = null;
  let currentRole: NormalizedRole | null = null;
  let currentSummoner: string | null = null;
  let currentMatchId: string | null = null;

  for (const record of records) {
    const parsed = safeParseMatch(record.rawPayload, record.compactPayload);
    const participants = parsed?.info?.participants ?? [];
    const patch = record.patch ?? extractPatchFromVersion(parsed?.info?.gameVersion);

    if (patch !== latestPatch || participants.length === 0) {
      continue;
    }

    participantsRead += participants.length;
    const extractedParticipants = participants
      .map((participant) => extractParticipant(participant, patch))
      .filter((participant): participant is ExtractedParticipant => participant !== null);
    participantsSkipped += participants.length - extractedParticipants.length;

    if (extractedParticipants.length === 0) {
      continue;
    }

    processedRecords += 1;
    analyzedRecordIds.push(record.id);

    for (const participant of extractedParticipants) {
      if (participant.recommendation) {
        accumulateRecommendationStats(recommendationAggregates, participant);
      }
      accumulateItemStats(itemAggregates, participant);
    }

    accumulateMatchups(matchupAggregates, extractedParticipants);

    const currentParticipant = extractedParticipants[0];
    currentChampionId = currentParticipant.championId;
    currentRole = currentParticipant.role;
    currentSummoner = record.puuid;
    currentMatchId = record.riotMatchId;
  }

  return {
    processedRecords,
    analyzedRecordIds,
    participantsRead,
    participantsSkipped,
    recommendationAggregates,
    itemAggregates,
    matchupAggregates,
    currentChampionId,
    currentRole,
    currentSummoner,
    currentMatchId,
  };
}

function getAnalysisRecordWhere(latestPatch: string) {
  return {
    OR: [
      {
        patch: latestPatch,
      },
      {
        patch: null,
      },
    ],
  };
}

function safeParseMatch(rawPayload: string | null, compactPayload?: string | null) {
  return parseStoredMatchPayload(rawPayload, compactPayload);
}

function extractParticipant(
  participant: RiotStoredParticipant,
  patch: string,
): ExtractedParticipant | null {
  const championId = participant.championId;
  const teamId = participant.teamId ?? null;
  const opponentChampionId = participant.opponentChampionId ?? null;
  const role = normalizeParticipantRole(participant);
  const primaryStyleId = participant.perks?.styles?.[0]?.style;
  const subStyleId = participant.perks?.styles?.[1]?.style;
  const summoner1Id = participant.summoner1Id;
  const summoner2Id = participant.summoner2Id;
  const selectedPerkIds = collectSelectedPerkIds(participant);

  if (!championId || !role) {
    return null;
  }

  return {
    patch,
    championId,
    teamId,
    opponentChampionId,
    role,
    win: Boolean(participant.win),
    recommendation:
      primaryStyleId &&
      subStyleId &&
      summoner1Id &&
      summoner2Id &&
      selectedPerkIds.length > 0
        ? {
            primaryStyleId,
            subStyleId,
            selectedPerkIds,
            summonerSpellIds: normalizeSummonerSpellPair(summoner1Id, summoner2Id),
          }
        : null,
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
  const finalItems = collectFinalItems(participant);

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

function collectFinalItems(participant: RiotStoredParticipant): number[] {
  return [
    participant.item0 ?? 0,
    participant.item1 ?? 0,
    participant.item2 ?? 0,
    participant.item3 ?? 0,
    participant.item4 ?? 0,
    participant.item5 ?? 0,
  ].filter((itemId): itemId is number => Number.isInteger(itemId) && itemId > 0);
}

function normalizeParticipantRole(participant: RiotStoredParticipant | undefined): NormalizedRole | null {
  if (!participant) {
    return null;
  }

  return normalizeRole(participant.teamPosition) ?? normalizeRole(participant.individualPosition);
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
  if (!participant.recommendation) {
    return;
  }

  const key = buildRecommendationAggregateKey({
    patch: participant.patch,
    championId: participant.championId,
    role: participant.role,
    primaryStyleId: participant.recommendation.primaryStyleId,
    subStyleId: participant.recommendation.subStyleId,
    selectedPerkIds: participant.recommendation.selectedPerkIds,
    summonerSpellIds: participant.recommendation.summonerSpellIds,
  });

  const current = aggregates.get(key) ?? {
    patch: participant.patch,
    championId: participant.championId,
    role: participant.role,
    primaryStyleId: participant.recommendation.primaryStyleId,
    subStyleId: participant.recommendation.subStyleId,
    selectedPerkIds: participant.recommendation.selectedPerkIds,
    summonerSpellIds: participant.recommendation.summonerSpellIds,
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
    const key = buildItemAggregateKey({
      patch: participant.patch,
      championId: participant.championId,
      role: participant.role,
      itemSetType: itemSet.itemSetType,
      itemIds: itemSet.itemIds,
    });

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
  for (const participant of participants) {
    if (!participant.opponentChampionId) {
      continue;
    }

    incrementMatchupAggregate(aggregates, {
      patch: participant.patch,
      championId: participant.championId,
      opponentChampionId: participant.opponentChampionId,
      role: participant.role,
      win: participant.win,
    });
  }

  const roleBuckets = new Map<NormalizedRole, ExtractedParticipant[]>();

  for (const participant of participants) {
    if (participant.opponentChampionId || participant.teamId === null) {
      continue;
    }

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

      incrementMatchupAggregate(aggregates, {
        patch: participant.patch,
        championId: participant.championId,
        opponentChampionId: opponent.championId,
        role,
        win: participant.win,
      });
    }
  }
}

function canBuildAnyMatchup(participants: ExtractedParticipant[]) {
  return participants.some(
    (participant) =>
      Boolean(participant.opponentChampionId) ||
      participants.some(
        (candidate) =>
          participant.teamId !== null &&
          candidate.teamId !== null &&
          candidate.role === participant.role &&
          candidate.teamId !== participant.teamId &&
          candidate.championId !== participant.championId,
      ),
  );
}

function incrementMatchupAggregate(
  aggregates: Map<string, MatchupAggregate>,
  entry: {
    patch: string;
    championId: number;
    opponentChampionId: number;
    role: NormalizedRole;
    win: boolean;
  },
) {
  const key = buildMatchupAggregateKey(entry);
  const current = aggregates.get(key) ?? {
    patch: entry.patch,
    championId: entry.championId,
    opponentChampionId: entry.opponentChampionId,
    role: entry.role,
    gamesCount: 0,
    wins: 0,
  };

  current.gamesCount += 1;
  if (entry.win) {
    current.wins += 1;
  }

  aggregates.set(key, current);
}

function mergeRecommendationAggregates(
  target: Map<string, RecommendationAggregate>,
  source: Map<string, RecommendationAggregate>,
) {
  for (const entry of source.values()) {
    const key = buildRecommendationAggregateKey(entry);
    const current = target.get(key);

    if (!current) {
      target.set(key, {
        ...entry,
        selectedPerkIds: [...entry.selectedPerkIds],
        summonerSpellIds: [...entry.summonerSpellIds] as [number, number],
      });
      continue;
    }

    current.gamesCount += entry.gamesCount;
    current.wins += entry.wins;
  }
}

function mergeItemAggregates(
  target: Map<string, ItemAggregate>,
  source: Map<string, ItemAggregate>,
) {
  for (const entry of source.values()) {
    const key = buildItemAggregateKey(entry);
    const current = target.get(key);

    if (!current) {
      target.set(key, { ...entry, itemIds: [...entry.itemIds] });
      continue;
    }

    current.gamesCount += entry.gamesCount;
    current.wins += entry.wins;
  }
}

function mergeMatchupAggregates(
  target: Map<string, MatchupAggregate>,
  source: Map<string, MatchupAggregate>,
) {
  for (const entry of source.values()) {
    const key = buildMatchupAggregateKey(entry);
    const current = target.get(key);

    if (!current) {
      target.set(key, { ...entry });
      continue;
    }

    current.gamesCount += entry.gamesCount;
    current.wins += entry.wins;
  }
}

function buildRecommendationAggregateKey(entry: {
  patch: string;
  championId: number;
  role: NormalizedRole;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
  summonerSpellIds: [number, number];
}) {
  return [
    entry.patch,
    entry.championId,
    entry.role,
    entry.primaryStyleId,
    entry.subStyleId,
    entry.selectedPerkIds.join("-"),
    entry.summonerSpellIds.join("-"),
  ].join(":");
}

function buildItemAggregateKey(entry: {
  patch: string;
  championId: number;
  role: NormalizedRole;
  itemSetType: ItemSetType;
  itemIds: number[];
}) {
  return [
    entry.patch,
    entry.championId,
    entry.role,
    entry.itemSetType,
    entry.itemIds.join("-"),
  ].join(":");
}

function buildMatchupAggregateKey(entry: {
  patch: string;
  championId: number;
  opponentChampionId: number;
  role: NormalizedRole;
}) {
  return [
    entry.patch,
    entry.championId,
    entry.opponentChampionId,
    entry.role,
  ].join(":");
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
      compactPayload: true,
      patch: true,
    },
    where: {
      patch: latestPatch,
    },
  });

  let count = 0;
  for (const record of records) {
    const parsed = safeParseMatch(record.rawPayload, record.compactPayload);
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

async function saveAnalyzerProgress(options: {
  jobLogId: string;
  startedAt: Date;
  processedRecords: number;
  totalRecords: number;
  recommendationStatsAdded: number;
  itemStatsAdded: number;
  matchupStatsAdded: number;
  currentChampion: string | null;
  currentRole: NormalizedRole | null;
  currentSummoner: string | null;
  currentMatchId: string | null;
}) {
  const progress = calculateProgress(options.processedRecords, options.totalRecords);
  const status = updateAnalyzerJobStatus({
    progress,
    processedMatches: options.processedRecords,
    recommendationStatsAdded: options.recommendationStatsAdded,
    itemStatsAdded: options.itemStatsAdded,
    matchupStatsAdded: options.matchupStatsAdded,
    currentChampion: options.currentChampion,
    currentRole: options.currentRole,
    estimatedRemainingMinutes: estimateRemainingMinutes(
      options.startedAt,
      options.processedRecords,
      options.totalRecords,
    ),
  });

  logInfo("[analyzer]", {
    champion: options.currentChampion,
    role: options.currentRole,
    matchesProcessed: options.processedRecords,
    recommendationsAdded: options.recommendationStatsAdded,
    itemStatsAdded: options.itemStatsAdded,
    matchupStatsAdded: options.matchupStatsAdded,
    currentSummoner: options.currentSummoner,
    currentMatchId: options.currentMatchId,
    progress: `${progress}%`,
  });

  await prisma.fetchJobLog.update({
    where: {
      id: options.jobLogId,
    },
    data: {
      recordsRead: options.processedRecords,
      recordsSaved:
        options.recommendationStatsAdded +
        options.itemStatsAdded +
        options.matchupStatsAdded,
      metadata: serializeAnalyzerJobStatus(status),
    },
  });

  await setAnalyticsJobState({
    status: "running",
    currentStage: "analyzing-stats",
    currentJob: "analyze-global-stats",
    progress,
    processedMatches: options.processedRecords,
    recommendationStatsAdded: options.recommendationStatsAdded,
    itemStatsAdded: options.itemStatsAdded,
    matchupStatsAdded: options.matchupStatsAdded,
    currentChampion: options.currentChampion,
    currentRole: options.currentRole,
    metadata: {
      currentSummoner: options.currentSummoner,
      currentMatchId: options.currentMatchId,
      totalRecords: options.totalRecords,
    },
  });
}

function calculateProgress(processedRecords: number, totalRecords: number) {
  if (totalRecords <= 0) {
    return 0;
  }

  return Math.min(99, Math.max(0, Math.floor((processedRecords / totalRecords) * 100)));
}

function estimateRemainingMinutes(
  startedAt: Date,
  processedRecords: number,
  totalRecords: number,
) {
  if (processedRecords <= 0 || totalRecords <= 0 || processedRecords >= totalRecords) {
    return null;
  }

  const elapsedMinutes = (Date.now() - startedAt.getTime()) / 60_000;
  const recordsPerMinute = processedRecords / Math.max(elapsedMinutes, 0.001);
  const remainingRecords = Math.max(0, totalRecords - processedRecords);

  return Math.max(1, Math.ceil(remainingRecords / recordsPerMinute));
}

function formatChampionName(championId: number | undefined, championNameById: Map<number, string>) {
  if (!championId) {
    return null;
  }

  return championNameById.get(championId) ?? `Champion ${championId}`;
}

async function getChampionNameMapping() {
  try {
    const response = await dataDragonService.getChampions();
    return new Map(
      Object.entries(response.mappings.championIdToChampionName).map(([championId, championName]) => [
        Number(championId),
        championName,
      ]),
    );
  } catch {
    return new Map<number, string>();
  }
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
