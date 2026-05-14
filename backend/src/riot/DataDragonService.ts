import { prisma } from "../lib/prisma.js";

const DATA_DRAGON_BASE_URL = "https://ddragon.leagueoflegends.com";
const PATCH_CACHE_TTL_MS = 60 * 60 * 1000;
const PATCH_CACHE_SOURCE = "data-dragon";

type DataDragonVersions = string[];

type DataDragonChampionPayload = {
  data: Record<
    string,
    {
      id: string;
      key: string;
      name: string;
      title: string;
    }
  >;
};

type DataDragonItemPayload = {
  data: Record<
    string,
    {
      name: string;
    }
  >;
};

type DataDragonRunePayload = Array<{
  id: number;
  name: string;
  slots: Array<{
    runes: Array<{
      id: number;
      name: string;
    }>;
  }>;
}>;

export type PatchInfoResponse = {
  ok: true;
  patch: string;
  source: "data-dragon";
  cached: boolean;
};

export type ChampionSummary = {
  id: number;
  key: string;
  name: string;
  title: string;
};

export type ChampionsResponse = {
  ok: true;
  patch: string;
  champions: ChampionSummary[];
  mappings: {
    championIdToChampionName: Record<string, string>;
    itemIdToItemName: Record<string, string>;
    perkIdToRuneName: Record<string, string>;
  };
};

export class DataDragonService {
  private latestPatchCache: { patch: string; expiresAt: number } | null = null;
  private championsCache: Map<string, ChampionsResponse> = new Map();

  async getLatestPatch(): Promise<PatchInfoResponse> {
    if (this.latestPatchCache && Date.now() <= this.latestPatchCache.expiresAt) {
      return {
        ok: true,
        patch: this.latestPatchCache.patch,
        source: "data-dragon",
        cached: true,
      };
    }

    const cachedPatch = await this.getCachedPatch();
    if (cachedPatch) {
      this.latestPatchCache = {
        patch: cachedPatch,
        expiresAt: Date.now() + PATCH_CACHE_TTL_MS,
      };
      return {
        ok: true,
        patch: cachedPatch,
        source: "data-dragon",
        cached: true,
      };
    }

    const versions = await this.requestJson<DataDragonVersions>("/api/versions.json");
    const patch = versions[0];

    if (!patch) {
      throw new Error("Data Dragon did not return a latest patch.");
    }

    await prisma.patchCache.upsert({
      where: {
        patch,
      },
      update: {
        source: PATCH_CACHE_SOURCE,
        payload: JSON.stringify({ patch, versions }),
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + PATCH_CACHE_TTL_MS),
      },
      create: {
        patch,
        source: PATCH_CACHE_SOURCE,
        payload: JSON.stringify({ patch, versions }),
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + PATCH_CACHE_TTL_MS),
      },
    });

    this.latestPatchCache = {
      patch,
      expiresAt: Date.now() + PATCH_CACHE_TTL_MS,
    };

    return {
      ok: true,
      patch,
      source: "data-dragon",
      cached: false,
    };
  }

  async getChampions(): Promise<ChampionsResponse> {
    const patchInfo = await this.getLatestPatch();
    const patch = patchInfo.patch;
    const cachedChampions = this.championsCache.get(patch);
    if (cachedChampions) {
      return cachedChampions;
    }

    const [championPayload, itemPayload, runePayload] = await Promise.all([
      this.requestJson<DataDragonChampionPayload>(`/cdn/${patch}/data/en_US/champion.json`),
      this.requestJson<DataDragonItemPayload>(`/cdn/${patch}/data/en_US/item.json`),
      this.requestJson<DataDragonRunePayload>(`/cdn/${patch}/data/en_US/runesReforged.json`),
    ]);

    const champions = Object.values(championPayload.data)
      .map((champion) => ({
        id: Number(champion.key),
        key: champion.id,
        name: champion.name,
        title: champion.title,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    const championIdToChampionName = Object.values(championPayload.data).reduce<Record<string, string>>((accumulator, champion) => {
      accumulator[champion.key] = champion.name;
      return accumulator;
    }, {});

    const itemIdToItemName = Object.entries(itemPayload.data).reduce<Record<string, string>>((accumulator, [itemId, item]) => {
      accumulator[itemId] = item.name;
      return accumulator;
    }, {});

    const perkIdToRuneName = runePayload.reduce<Record<string, string>>((accumulator, style) => {
      accumulator[String(style.id)] = style.name;

      for (const slot of style.slots) {
        for (const rune of slot.runes) {
          accumulator[String(rune.id)] = rune.name;
        }
      }

      return accumulator;
    }, {});

    const response: ChampionsResponse = {
      ok: true,
      patch,
      champions,
      mappings: {
        championIdToChampionName,
        itemIdToItemName,
        perkIdToRuneName,
      },
    };

    this.championsCache.set(patch, response);
    for (const cachedPatch of this.championsCache.keys()) {
      if (cachedPatch !== patch) {
        this.championsCache.delete(cachedPatch);
      }
    }

    return response;
  }

  private async getCachedPatch(): Promise<string | null> {
    const latestCacheEntry = await prisma.patchCache.findFirst({
      where: {
        source: PATCH_CACHE_SOURCE,
      },
      orderBy: {
        fetchedAt: "desc",
      },
    });

    if (!latestCacheEntry) {
      return null;
    }

    const expiresAt = latestCacheEntry.expiresAt?.getTime() ?? latestCacheEntry.fetchedAt.getTime() + PATCH_CACHE_TTL_MS;
    if (Date.now() > expiresAt) {
      return null;
    }

    return latestCacheEntry.patch;
  }

  private async requestJson<T>(path: string): Promise<T> {
    const response = await fetch(`${DATA_DRAGON_BASE_URL}${path}`, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Data Dragon request failed with status ${response.status} for ${path}`);
    }

    return (await response.json()) as T;
  }
}

export const dataDragonService = new DataDragonService();
