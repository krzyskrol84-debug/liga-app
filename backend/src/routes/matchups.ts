import { Router } from "express";
import { z } from "zod";
import { getCachedAnalyticsValue, setCachedAnalyticsValue } from "../lib/analyticsCache.js";
import { prisma } from "../lib/prisma.js";

const roleSchema = z.enum(["top", "jungle", "middle", "bottom", "utility"]);

const matchupsQuerySchema = z.object({
  championId: z.coerce.number().int().positive("championId must be a positive integer"),
  role: roleSchema,
});

type MatchupEntry = {
  opponentChampionId: number;
  winRate: number;
  gamesCount: number;
  wins: number;
  difficulty: "favorable" | "even" | "hard" | "severe";
  patch: string;
};

export const matchupsRouter = Router();

matchupsRouter.get("/", async (request, response, next) => {
  try {
    const parsed = matchupsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return response.status(400).json({
        ok: false,
        error: "Invalid query parameters.",
        details: parsed.error.flatten(),
      });
    }

    const { championId, role } = parsed.data;
    const cacheKey = `matchups:${championId}:${role}`;
    const cached = getCachedAnalyticsValue<{
      toughestMatchups: MatchupEntry[];
      bestMatchups: MatchupEntry[];
    }>(cacheKey);
    if (cached) {
      return response.json(cached);
    }

    const matchupRows = await prisma.matchupStats.findMany({
      where: {
        championId,
        role,
        source: "riot-api",
      },
      orderBy: [
        { patch: "desc" },
        { gamesCount: "desc" },
      ],
    });

    if (matchupRows.length === 0) {
      const payload = {
        toughestMatchups: [],
        bestMatchups: [],
      };
      setCachedAnalyticsValue(cacheKey, payload);
      return response.json(payload);
    }

    const latestPatch = matchupRows[0]?.patch;
    const latestPatchRows = matchupRows.filter((row) => row.patch === latestPatch);

    const entries = latestPatchRows.map<MatchupEntry>((row) => ({
      opponentChampionId: row.opponentChampionId,
      winRate: row.winRate,
      gamesCount: row.gamesCount,
      wins: row.wins,
      difficulty: classifyDifficulty(row.winRate),
      patch: row.patch,
    }));

    const toughestMatchups = [...entries]
      .sort((left, right) => {
        if (left.winRate !== right.winRate) {
          return left.winRate - right.winRate;
        }
        return right.gamesCount - left.gamesCount;
      })
      .slice(0, 5);

    const bestMatchups = [...entries]
      .sort((left, right) => {
        if (left.winRate !== right.winRate) {
          return right.winRate - left.winRate;
        }
        return right.gamesCount - left.gamesCount;
      })
      .slice(0, 5);

    const payload = {
      toughestMatchups,
      bestMatchups,
    };
    setCachedAnalyticsValue(cacheKey, payload);
    return response.json(payload);
  } catch (error) {
    next(error);
  }
});

function classifyDifficulty(winRate: number): MatchupEntry["difficulty"] {
  if (winRate < 45) {
    return "severe";
  }
  if (winRate < 49) {
    return "hard";
  }
  if (winRate <= 51) {
    return "even";
  }
  return "favorable";
}
