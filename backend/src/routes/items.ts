import { Router } from "express";
import { z } from "zod";
import { getCachedAnalyticsValue, setCachedAnalyticsValue } from "../lib/analyticsCache.js";
import { prisma } from "../lib/prisma.js";

const roleSchema = z.enum(["top", "jungle", "middle", "bottom", "utility"]);

const itemsQuerySchema = z.object({
  championId: z.coerce.number().int().positive("championId must be a positive integer"),
  role: roleSchema,
});

type ItemOption = {
  itemIds: number[];
  winRate: number;
  gamesCount: number;
  wins: number;
  pickRate: number;
  patch: string;
};

type NormalizedItemRow = ItemOption & {
  itemSetType: string;
}

export const itemsRouter = Router();

itemsRouter.get("/", async (request, response) => {
  const parsed = itemsQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid query parameters.",
      details: parsed.error.flatten(),
    });
  }

  const { championId, role } = parsed.data;
  const cacheKey = `items:${championId}:${role}`;
  const cached = getCachedAnalyticsValue<ReturnType<typeof emptySections>>(cacheKey);
  if (cached) {
    return response.json(cached);
  }

  const itemRows = await prisma.itemStats.findMany({
    where: {
      championId,
      role,
    },
    select: {
      patch: true,
      itemSetType: true,
      itemSetIds: true,
      itemSetKey: true,
      wins: true,
      winRate: true,
      pickRate: true,
      gamesCount: true,
      matches: true,
      fetchedAt: true,
    },
    orderBy: [
      { patch: "desc" },
      { winRate: "desc" },
      { matches: "desc" },
      { fetchedAt: "desc" },
    ],
  });

  if (itemRows.length === 0) {
    const payload = emptySections();
    setCachedAnalyticsValue(cacheKey, payload);
    return response.json(payload);
  }

  const latestPatch = itemRows[0]?.patch;
  const latestPatchRows = itemRows.filter((row) => row.patch === latestPatch);

  const normalizedRows: NormalizedItemRow[] = latestPatchRows
    .map((row) => ({
      itemSetType: row.itemSetType,
      itemIds: parseNumberArray(row.itemSetIds),
      winRate: row.winRate ?? 0,
      gamesCount: row.gamesCount ?? row.matches ?? 0,
      wins: row.wins,
      pickRate: row.pickRate ?? 0,
      patch: row.patch,
    }))
    .filter((row) => row.itemIds.length > 0);

  if (normalizedRows.length === 0) {
    const payload = emptySections();
    setCachedAnalyticsValue(cacheKey, payload);
    return response.json(payload);
  }

  const startingItems = buildSection(
    normalizedRows.filter((row) => row.itemSetType === "starting"),
    "Starting",
  );
  const coreItems = buildSection(
    normalizedRows.filter((row) => row.itemSetType === "core"),
    "Core",
  );
  const fourthItemOptions = buildSection(
    normalizedRows.filter((row) => row.itemSetType === "fourth"),
    "Fourth Option",
  );
  const fifthItemOptions = buildSection(
    normalizedRows.filter((row) => row.itemSetType === "fifth"),
    "Fifth Option",
  );
  const sixthItemOptions = buildSection(
    normalizedRows.filter((row) => row.itemSetType === "sixth"),
    "Sixth Option",
  );

  const payload = {
    startingItems,
    coreItems,
    fourthItemOptions,
    fifthItemOptions,
    sixthItemOptions,
  };
  setCachedAnalyticsValue(cacheKey, payload);
  return response.json(payload);
});

function buildSection(rows: ItemOption[], _fallbackLabelPrefix: string): ItemOption[] {
  return rows
    .sort((left, right) => {
      return right.gamesCount - left.gamesCount;
    })
    .map((row) => ({
      itemIds: row.itemIds,
      winRate: row.winRate,
      gamesCount: row.gamesCount,
      wins: row.wins,
      pickRate: row.pickRate,
      patch: row.patch,
    }));
}

function parseNumberArray(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is number => Number.isInteger(entry) && entry > 0);
  } catch {
    return [];
  }
}

function emptySections() {
  return {
    startingItems: [],
    coreItems: [],
    fourthItemOptions: [],
    fifthItemOptions: [],
    sixthItemOptions: [],
  };
}
