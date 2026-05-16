import { Router } from "express";
import { z } from "zod";
import { getCachedAnalyticsValue, setCachedAnalyticsValue } from "../lib/analyticsCache.js";
import { prisma } from "../lib/prisma.js";
import { getConfidence, MIN_ITEM_GAMES, MIN_RECOMMENDATION_GAMES } from "../lib/confidence.js";

const roleSchema = z.enum(["top", "jungle", "middle", "bottom", "utility"]);

const recommendationsQuerySchema = z.object({
  championId: z.coerce.number().int().positive("championId must be a positive integer"),
  role: roleSchema,
});

export const recommendationsRouter = Router();

recommendationsRouter.get("/", async (request, response) => {
  const parsed = recommendationsQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid query parameters.",
      details: parsed.error.flatten(),
    });
  }

  const { championId, role } = parsed.data;
  const cacheKey = `recommendations:${championId}:${role}`;
  const cached = getCachedAnalyticsValue<unknown[]>(cacheKey);
  if (cached) {
    return response.json(cached);
  }

  const recommendationRows = await prisma.recommendationStats.findMany({
    where: {
      championId,
      role,
      source: "riot-api",
    },
    orderBy: [
      { gamesCount: "desc" },
      { winRate: "desc" },
      { patch: "desc" },
    ],
    take: 5,
  });

  if (recommendationRows.length === 0) {
    setCachedAnalyticsValue(cacheKey, []);
    return response.json([]);
  }

  const itemRows = await prisma.itemStats.findMany({
    where: {
      championId,
      role,
      source: "riot-api",
      patch: {
        in: [...new Set(recommendationRows.map((row) => row.patch))],
      },
    },
    select: {
      patch: true,
      itemSetType: true,
      itemSetIds: true,
      wins: true,
      winRate: true,
      gamesCount: true,
      matches: true,
    },
    orderBy: [
      { patch: "desc" },
      { winRate: "desc" },
      { matches: "desc" },
    ],
  });

  const itemsByPatch = new Map<
    string,
    Array<{
      itemSetType: string;
      itemIds: number[];
      gamesCount: number;
      wins: number;
      winRate: number;
    }>
  >();
  for (const row of itemRows) {
    const current = itemsByPatch.get(row.patch) ?? [];
    current.push({
      itemSetType: row.itemSetType,
      itemIds: parseNumberArray(row.itemSetIds),
      gamesCount: row.gamesCount ?? row.matches ?? 0,
      wins: row.wins,
      winRate: row.winRate ?? 0,
      ...getConfidence(row.gamesCount ?? row.matches ?? 0, MIN_ITEM_GAMES),
    });
    itemsByPatch.set(row.patch, current);
  }

  const payload = recommendationRows.map((row) => ({
    championId: row.championId,
    role: row.role,
    primaryStyleId: row.primaryStyleId,
    subStyleId: row.subStyleId,
    selectedPerkIds: parseNumberArray(row.selectedPerkIds),
    summonerSpellIds: parseNumberArray(row.summonerSpellIds),
    itemRecommendations: (itemsByPatch.get(row.patch) ?? []).sort(
      (left, right) => right.gamesCount - left.gamesCount || right.winRate - left.winRate,
    ),
    winRate: row.winRate,
    gamesCount: row.gamesCount,
    wins: row.wins,
    patch: row.patch,
    source: "riot-api" as const,
    ...getConfidence(row.gamesCount, MIN_RECOMMENDATION_GAMES),
  }));

  setCachedAnalyticsValue(cacheKey, payload);

  return response.json(payload);
});

function parseNumberArray(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is number => Number.isInteger(entry));
  } catch {
    return [];
  }
}
