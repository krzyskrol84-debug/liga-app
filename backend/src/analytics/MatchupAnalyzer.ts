import { prisma } from "../lib/prisma.js";
import { clearAnalyticsCache } from "../lib/analyticsCache.js";
import { assertNoRunningJob } from "../lib/jobGuards.js";

type SupportedRole = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
type NormalizedRole = "top" | "jungle" | "middle" | "bottom" | "utility";

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
};

type MatchupAggregate = {
  patch: string;
  championId: number;
  opponentChampionId: number;
  role: NormalizedRole;
  gamesCount: number;
  wins: number;
};

export type AnalyzeMatchupsResult = {
  ok: true;
  processedRecords: number;
  processedMatchups: number;
  matchupStatsSaved: number;
};

export class MatchupAnalyzer {
  async analyzeSavedMatchups(): Promise<AnalyzeMatchupsResult> {
    await assertNoRunningJob("analyze-matchups");
    const startedAt = new Date();
    const jobLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "analyze-matchups",
        status: "running",
        target: "match-records",
        startedAt,
      },
    });

    try {
      const records = await prisma.matchRecord.findMany({
        orderBy: {
          createdAt: "desc",
        },
      });

      const aggregates = new Map<string, MatchupAggregate>();
      let processedMatchups = 0;

      for (const record of records) {
        const parsed = safeParseMatch(record.rawPayload);
        const participants = parsed?.info?.participants ?? [];
        const patch = record.patch ?? extractPatchFromVersion(parsed?.info?.gameVersion);

        if (!patch || participants.length === 0) {
          continue;
        }

        const roleBuckets = new Map<NormalizedRole, RiotStoredParticipant[]>();

        for (const participant of participants) {
          const role = normalizeRole(participant.teamPosition);
          if (!role || !participant.championId || !participant.teamId) {
            continue;
          }

          const bucket = roleBuckets.get(role) ?? [];
          bucket.push(participant);
          roleBuckets.set(role, bucket);
        }

        for (const [role, roleParticipants] of roleBuckets.entries()) {
          if (roleParticipants.length < 2) {
            continue;
          }

          for (const participant of roleParticipants) {
            const opponent = roleParticipants.find(
              (candidate) =>
                candidate.teamId !== participant.teamId &&
                candidate.championId &&
                candidate.teamPosition === participant.teamPosition,
            );

            if (!participant.championId || !participant.teamId || !opponent?.championId) {
              continue;
            }

            processedMatchups += 1;
            accumulateMatchup(aggregates, {
              patch,
              championId: participant.championId,
              opponentChampionId: opponent.championId,
              role,
              win: Boolean(participant.win),
            });
          }
        }
      }

      const source = "riot-api";
      const now = new Date();
      const rows = [...aggregates.values()].map((entry) => ({
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

      await prisma.$transaction(
        rows.map((row) =>
          prisma.matchupStats.upsert({
            where: {
              patch_championId_opponentChampionId_role_source: {
                patch: row.patch,
                championId: row.championId,
                opponentChampionId: row.opponentChampionId,
                role: row.role,
                source: row.source,
              },
            },
            update: row,
            create: row,
          }),
        ),
      );

      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: { id: jobLog.id },
        data: {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          recordsRead: records.length,
          recordsSaved: rows.length,
          metadata: JSON.stringify({
            processedMatchups,
            matchupStatsSaved: rows.length,
          }),
        },
      });

      clearAnalyticsCache("matchups:");

      return {
        ok: true,
        processedRecords: records.length,
        processedMatchups,
        matchupStatsSaved: rows.length,
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
      clearAnalyticsCache("matchups:");
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

function accumulateMatchup(
  aggregates: Map<string, MatchupAggregate>,
  entry: {
    patch: string;
    championId: number;
    opponentChampionId: number;
    role: NormalizedRole;
    win: boolean;
  },
) {
  const key = [
    entry.patch,
    entry.championId,
    entry.opponentChampionId,
    entry.role,
  ].join(":");

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

function calculateWinRate(wins: number, gamesCount: number): number {
  if (gamesCount <= 0) {
    return 0;
  }

  return Number(((wins / gamesCount) * 100).toFixed(2));
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

export const matchupAnalyzer = new MatchupAnalyzer();
