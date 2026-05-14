import {
  DataDragonClient,
  getAllRunes,
  type DataDragonCacheOptions,
  type DataDragonData,
} from "../riot/dataDragon.js";
import type { PatchInfo } from "../models/appModels.js";

export class PatchManager {
  private readonly client: DataDragonClient;
  private cache: DataDragonData | null = null;

  constructor(options: DataDragonCacheOptions = {}) {
    this.client = new DataDragonClient(options);
  }

  async getCurrentPatch(): Promise<string> {
    return this.client.getLatestVersion();
  }

  async loadCurrentData(forceRefresh = false): Promise<DataDragonData> {
    if (!forceRefresh && this.cache) {
      const updateAvailable = await this.client.isPatchUpdateAvailable();
      if (!updateAvailable) return this.cache;
    }

    this.cache = await this.client.load({ forceRefresh });
    return this.cache;
  }

  async refreshIfPatchChanged(): Promise<{ changed: boolean; data: DataDragonData }> {
    const current = this.cache?.version;
    const data = await this.loadCurrentData();
    return { changed: current !== undefined && current !== data.version, data };
  }

  async getPatchInfo(): Promise<PatchInfo> {
    const data = await this.loadCurrentData();
    return {
      patch: data.version,
      language: data.language,
      fetchedAt: new Date().toISOString(),
      isCurrent: true,
    };
  }

  async getChampionCount(): Promise<number> {
    const data = await this.loadCurrentData();
    return Object.keys(data.champions).length;
  }

  async getRuneCount(): Promise<number> {
    const data = await this.loadCurrentData();
    return getAllRunes(data).length;
  }
}
