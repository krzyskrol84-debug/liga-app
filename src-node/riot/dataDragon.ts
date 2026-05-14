import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import axios, { type AxiosInstance } from "axios";

export type DataDragonLanguage = "en_US" | "pl_PL" | string;

export type DataDragonCacheOptions = {
  cacheDir?: string;
  language?: DataDragonLanguage;
  baseUrl?: string;
  timeoutMs?: number;
};

export type DataDragonLoadOptions = DataDragonCacheOptions & {
  forceRefresh?: boolean;
};

export type DataDragonImage = {
  full: string;
  sprite: string;
  group: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DataDragonChampionInfo = {
  attack: number;
  defense: number;
  magic: number;
  difficulty: number;
};

export type DataDragonChampionStats = Record<string, number>;

export type DataDragonChampion = {
  version: string;
  id: string;
  key: string;
  name: string;
  title: string;
  blurb: string;
  info: DataDragonChampionInfo;
  image: DataDragonImage;
  tags: string[];
  partype: string;
  stats: DataDragonChampionStats;
};

export type DataDragonSummonerSpell = {
  id: string;
  name: string;
  description: string;
  tooltip: string;
  maxrank: number;
  cooldown: number[];
  cooldownBurn: string;
  cost: number[];
  costBurn: string;
  datavalues: Record<string, unknown>;
  effect: Array<number[] | null>;
  effectBurn: Array<string | null>;
  vars: unknown[];
  key: string;
  summonerLevel: number;
  modes: string[];
  costType: string;
  maxammo: string;
  range: number[];
  rangeBurn: string;
  image: DataDragonImage;
  resource: string;
};

export type DataDragonItem = {
  name: string;
  description: string;
  colloq: string;
  plaintext: string;
  image: DataDragonImage;
  gold: {
    base: number;
    purchasable: boolean;
    total: number;
    sell: number;
  };
  tags: string[];
  maps: Record<string, boolean>;
  stats: Record<string, number>;
};

export type DataDragonRune = {
  id: number;
  key: string;
  icon: string;
  name: string;
  shortDesc: string;
  longDesc: string;
};

export type DataDragonRuneSlot = {
  runes: DataDragonRune[];
};

export type DataDragonPerkStyle = {
  id: number;
  key: string;
  icon: string;
  name: string;
  slots: DataDragonRuneSlot[];
};

export type DataDragonChampionResponse = {
  type: string;
  format: string;
  version: string;
  data: Record<string, DataDragonChampion>;
};

export type DataDragonSummonerSpellResponse = {
  type: string;
  version: string;
  data: Record<string, DataDragonSummonerSpell>;
};

export type DataDragonItemResponse = {
  type: string;
  version: string;
  data: Record<string, DataDragonItem>;
};

export type DataDragonCacheManifest = {
  version: string;
  language: string;
  updatedAt: string;
  files: {
    champions: string;
    summonerSpells: string;
    items: string;
    runes: string;
  };
};

export type DataDragonData = {
  version: string;
  language: string;
  champions: Record<string, DataDragonChampion>;
  summonerSpells: Record<string, DataDragonSummonerSpell>;
  items: Record<string, DataDragonItem>;
  perkStyles: DataDragonPerkStyle[];
};

export class DataDragonError extends Error {
  readonly code:
    | "VERSION_FETCH_FAILED"
    | "DOWNLOAD_FAILED"
    | "CACHE_READ_FAILED"
    | "CACHE_WRITE_FAILED"
    | "INVALID_CACHE";
  readonly details?: unknown;

  constructor(code: DataDragonError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "DataDragonError";
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_BASE_URL = "https://ddragon.leagueoflegends.com";
const DEFAULT_LANGUAGE = "en_US";

export class DataDragonClient {
  private readonly http: AxiosInstance;
  private readonly cacheDir: string;
  private readonly language: string;
  private readonly baseUrl: string;

  constructor(options: DataDragonCacheOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL);
    this.language = options.language ?? DEFAULT_LANGUAGE;
    this.cacheDir = options.cacheDir ?? getDefaultCacheDir();
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: options.timeoutMs ?? 15_000,
    });
  }

  async getLatestVersion(): Promise<string> {
    try {
      const response = await this.http.get<string[]>("/api/versions.json");
      const latest = response.data[0];

      if (!latest) {
        throw new Error("Data Dragon versions response was empty.");
      }

      return latest;
    } catch (error) {
      throw new DataDragonError("VERSION_FETCH_FAILED", "Could not fetch latest Data Dragon version.", {
        cause: formatUnknownError(error),
      });
    }
  }

  async load(options: DataDragonLoadOptions = {}): Promise<DataDragonData> {
    const latestVersion = await this.getLatestVersion();
    const cachedManifest = await this.readManifest();

    if (
      !options.forceRefresh &&
      cachedManifest?.version === latestVersion &&
      cachedManifest.language === this.language
    ) {
      return this.readCache(cachedManifest);
    }

    if (cachedManifest && cachedManifest.version !== latestVersion) {
      await this.clearCache();
    }

    return this.refresh(latestVersion);
  }

  async refresh(version?: string): Promise<DataDragonData> {
    const resolvedVersion = version ?? (await this.getLatestVersion());
    const [championResponse, summonerSpellResponse, itemResponse, perkStyles] = await Promise.all([
      this.downloadJson<DataDragonChampionResponse>(
        `/cdn/${resolvedVersion}/data/${this.language}/champion.json`,
      ),
      this.downloadJson<DataDragonSummonerSpellResponse>(
        `/cdn/${resolvedVersion}/data/${this.language}/summoner.json`,
      ),
      this.downloadJson<DataDragonItemResponse>(`/cdn/${resolvedVersion}/data/${this.language}/item.json`),
      this.downloadJson<DataDragonPerkStyle[]>(`/cdn/${resolvedVersion}/data/${this.language}/runesReforged.json`),
    ]);

    const data: DataDragonData = {
      version: resolvedVersion,
      language: this.language,
      champions: championResponse.data,
      summonerSpells: summonerSpellResponse.data,
      items: itemResponse.data,
      perkStyles,
    };

    await this.writeCache(data);
    return data;
  }

  async isPatchUpdateAvailable(): Promise<boolean> {
    const [latestVersion, manifest] = await Promise.all([this.getLatestVersion(), this.readManifest()]);
    return !manifest || manifest.version !== latestVersion || manifest.language !== this.language;
  }

  getCachePaths() {
    return getCachePaths(this.cacheDir);
  }

  async clearCache(): Promise<void> {
    await rm(this.cacheDir, { recursive: true, force: true });
  }

  private async downloadJson<T>(url: string): Promise<T> {
    try {
      const response = await this.http.get<T>(url);
      return response.data;
    } catch (error) {
      throw new DataDragonError("DOWNLOAD_FAILED", `Could not download Data Dragon file: ${url}`, {
        url,
        cause: formatUnknownError(error),
      });
    }
  }

  private async readManifest(): Promise<DataDragonCacheManifest | null> {
    const paths = this.getCachePaths();

    try {
      const raw = await readFile(paths.manifest, "utf8");
      return JSON.parse(raw) as DataDragonCacheManifest;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }

      throw new DataDragonError("CACHE_READ_FAILED", "Could not read Data Dragon cache manifest.", {
        path: paths.manifest,
        cause: formatUnknownError(error),
      });
    }
  }

  private async readCache(manifest: DataDragonCacheManifest): Promise<DataDragonData> {
    const paths = this.getCachePaths();

    try {
      const [championsRaw, summonerSpellsRaw, itemsRaw, runesRaw] = await Promise.all([
        readFile(paths.champions, "utf8"),
        readFile(paths.summonerSpells, "utf8"),
        readFile(paths.items, "utf8"),
        readFile(paths.runes, "utf8"),
      ]);

      return {
        version: manifest.version,
        language: manifest.language,
        champions: JSON.parse(championsRaw) as Record<string, DataDragonChampion>,
        summonerSpells: JSON.parse(summonerSpellsRaw) as Record<string, DataDragonSummonerSpell>,
        items: JSON.parse(itemsRaw) as Record<string, DataDragonItem>,
        perkStyles: JSON.parse(runesRaw) as DataDragonPerkStyle[],
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new DataDragonError("INVALID_CACHE", "Data Dragon cache manifest exists, but cache files are missing.", {
          manifest,
          cause: formatUnknownError(error),
        });
      }

      throw new DataDragonError("CACHE_READ_FAILED", "Could not read Data Dragon cache files.", {
        manifest,
        cause: formatUnknownError(error),
      });
    }
  }

  private async writeCache(data: DataDragonData): Promise<void> {
    const paths = this.getCachePaths();
    const manifest: DataDragonCacheManifest = {
      version: data.version,
      language: data.language,
      updatedAt: new Date().toISOString(),
      files: {
        champions: path.basename(paths.champions),
        summonerSpells: path.basename(paths.summonerSpells),
        items: path.basename(paths.items),
        runes: path.basename(paths.runes),
      },
    };

    try {
      await mkdir(this.cacheDir, { recursive: true });
      await Promise.all([
        writeJson(paths.champions, data.champions),
        writeJson(paths.summonerSpells, data.summonerSpells),
        writeJson(paths.items, data.items),
        writeJson(paths.runes, data.perkStyles),
        writeJson(paths.manifest, manifest),
      ]);
    } catch (error) {
      throw new DataDragonError("CACHE_WRITE_FAILED", "Could not write Data Dragon cache files.", {
        cacheDir: this.cacheDir,
        cause: formatUnknownError(error),
      });
    }
  }
}

export function createDataDragonClient(options?: DataDragonCacheOptions): DataDragonClient {
  return new DataDragonClient(options);
}

export async function loadDataDragon(options?: DataDragonLoadOptions): Promise<DataDragonData> {
  return new DataDragonClient(options).load(options);
}

export function getChampionByKey(data: DataDragonData, key: number | string): DataDragonChampion | undefined {
  const normalized = String(key);
  return Object.values(data.champions).find((champion) => champion.key === normalized);
}

export function getChampionById(data: DataDragonData, id: string): DataDragonChampion | undefined {
  return data.champions[id];
}

export function getChampionByName(data: DataDragonData, name: string): DataDragonChampion | undefined {
  const normalized = normalizeName(name);
  return Object.values(data.champions).find((champion) => normalizeName(champion.name) === normalized);
}

export function mapChampionById(data: DataDragonData, championId: number | string): MappedChampion {
  const champion = getChampionByKey(data, championId);
  const id = Number(championId);

  return {
    id: Number.isFinite(id) ? id : 0,
    name: champion?.name ?? `Champion ${championId}`,
    iconUrl: champion ? getChampionIconUrl(data, champion) : null,
    exists: Boolean(champion),
  };
}

export function getSummonerSpellByKey(
  data: DataDragonData,
  key: number | string,
): DataDragonSummonerSpell | undefined {
  const normalized = String(key);
  return Object.values(data.summonerSpells).find((spell) => spell.key === normalized);
}

export function getSummonerSpellById(data: DataDragonData, id: string): DataDragonSummonerSpell | undefined {
  return data.summonerSpells[id];
}

export function getSummonerSpellByNameOrId(
  data: DataDragonData,
  nameOrId: string,
): DataDragonSummonerSpell | undefined {
  const normalized = normalizeDataDragonName(nameOrId);
  return Object.values(data.summonerSpells).find(
    (spell) =>
      normalizeDataDragonName(spell.name) === normalized ||
      normalizeDataDragonName(spell.id) === normalized ||
      normalizeDataDragonName(spell.key) === normalized,
  );
}

export function getPerkStyleById(data: DataDragonData, id: number): DataDragonPerkStyle | undefined {
  return data.perkStyles.find((style) => style.id === id);
}

export function getPerkStyleByName(data: DataDragonData, name: string): DataDragonPerkStyle | undefined {
  const normalized = normalizeDataDragonName(name);
  return data.perkStyles.find(
    (style) => normalizeDataDragonName(style.name) === normalized || normalizeDataDragonName(style.key) === normalized,
  );
}

export function getPerkStyleIdByName(name: string, data?: DataDragonData): number | null {
  const style = data ? getPerkStyleByName(data, name) : undefined;
  return style?.id ?? FALLBACK_RUNE_STYLE_IDS[normalizeDataDragonName(name)] ?? null;
}

export function getRuneById(data: DataDragonData, id: number): DataDragonRune | undefined {
  for (const style of data.perkStyles) {
    for (const slot of style.slots) {
      const rune = slot.runes.find((candidate) => candidate.id === id);

      if (rune) {
        return rune;
      }
    }
  }

  return undefined;
}

export function getAllRunes(data: DataDragonData): DataDragonRune[] {
  return data.perkStyles.flatMap((style) => style.slots.flatMap((slot) => slot.runes));
}

export function getRuneByName(data: DataDragonData, name: string): DataDragonRune | undefined {
  const normalized = normalizeDataDragonName(name);
  return getAllRunes(data).find(
    (rune) => normalizeDataDragonName(rune.name) === normalized || normalizeDataDragonName(rune.key) === normalized,
  );
}

export function getPerkStylesForRunes(
  data: DataDragonData,
  selectedPerkIds: readonly number[],
): DataDragonPerkStyle[] {
  return data.perkStyles.filter((style) =>
    style.slots.some((slot) => slot.runes.some((rune) => selectedPerkIds.includes(rune.id))),
  );
}

export type MappedRune = {
  id: number;
  name: string;
  iconUrl: string | null;
  exists: boolean;
};

export type MappedChampion = {
  id: number;
  name: string;
  iconUrl: string | null;
  exists: boolean;
};

export type MappedSummonerSpell = {
  id: number;
  name: string;
  iconUrl: string | null;
  exists: boolean;
};

export type MappedItem = {
  id: number;
  name: string;
  iconUrl: string | null;
  exists: boolean;
};

export function mapSelectedPerkIds(data: DataDragonData, selectedPerkIds: number[]): MappedRune[] {
  return selectedPerkIds.map((id) => {
    const rune = getRuneById(data, id) ?? getStatShardById(id);

    return {
      id,
      name: rune?.name ?? `Rune ${id}`,
      iconUrl: isDataDragonRune(rune) ? getPerkIconUrl(rune) : null,
      exists: Boolean(rune),
    };
  });
}

export function mapSummonerSpellIds(data: DataDragonData, spellIds: readonly number[]): MappedSummonerSpell[] {
  return spellIds.map((id) => {
    const spell = getSummonerSpellByKey(data, id);

    return {
      id,
      name: spell?.name ?? `Spell ${id}`,
      iconUrl: spell ? getSummonerSpellIconUrl(data, spell) : null,
      exists: Boolean(spell),
    };
  });
}

export function getItemById(data: DataDragonData, itemId: number | string): DataDragonItem | undefined {
  return data.items[String(itemId)];
}

export function mapItemId(data: DataDragonData, itemId: number | string): MappedItem {
  const id = Number(itemId);
  const item = getItemById(data, itemId);

  return {
    id: Number.isFinite(id) ? id : 0,
    name: item?.name ?? `Item ${itemId}`,
    iconUrl: item ? getItemIconUrl(data, itemId) : null,
    exists: Boolean(item),
  };
}

export function mapItemIds(data: DataDragonData, itemIds: readonly (number | string)[]): MappedItem[] {
  return itemIds.map((itemId) => mapItemId(data, itemId));
}

export function isKnownStatShard(id: number): boolean {
  return Boolean(getStatShardById(id));
}

export function isCachePatchStale(manifest: Pick<DataDragonCacheManifest, "version" | "language"> | null, latestVersion: string, language = DEFAULT_LANGUAGE): boolean {
  return !manifest || manifest.version !== latestVersion || manifest.language !== language;
}

export async function clearDataDragonCache(options: DataDragonCacheOptions = {}): Promise<void> {
  const cacheDir = options.cacheDir ?? getDefaultCacheDir();
  await rm(cacheDir, { recursive: true, force: true });
}

export function getChampionIconUrl(data: DataDragonData, champion: DataDragonChampion): string {
  return `${DEFAULT_BASE_URL}/cdn/${data.version}/img/champion/${champion.image.full}`;
}

export function getSummonerSpellIconUrl(data: DataDragonData, spell: DataDragonSummonerSpell): string {
  return `${DEFAULT_BASE_URL}/cdn/${data.version}/img/spell/${spell.image.full}`;
}

export function getItemIconUrl(data: DataDragonData, itemId: number | string): string {
  return `${DEFAULT_BASE_URL}/cdn/${data.version}/img/item/${itemId}.png`;
}

export function getPerkIconUrl(runeOrStyle: Pick<DataDragonRune | DataDragonPerkStyle, "icon">): string {
  return `${DEFAULT_BASE_URL}/cdn/img/${runeOrStyle.icon}`;
}

function getDefaultCacheDir(): string {
  return path.join(os.homedir(), ".liga", "data-dragon");
}

function getStatShardById(id: number): Pick<DataDragonRune, "id" | "key" | "name"> | null {
  const names: Record<number, string> = {
    5001: "Health",
    5002: "Armor",
    5003: "Magic Resist",
    5005: "Attack Speed",
    5007: "Ability Haste",
    5008: "Adaptive Force",
    5011: "Health Scaling",
  };

  const name = names[id];
  return name ? { id, key: `StatMod${id}`, name } : null;
}

function isDataDragonRune(value: DataDragonRune | Pick<DataDragonRune, "id" | "key" | "name"> | null | undefined): value is DataDragonRune {
  return Boolean(value && "icon" in value && typeof value.icon === "string");
}

function getCachePaths(cacheDir: string) {
  return {
    manifest: path.join(cacheDir, "manifest.json"),
    champions: path.join(cacheDir, "champions.json"),
    summonerSpells: path.join(cacheDir, "summoner-spells.json"),
    items: path.join(cacheDir, "items.json"),
    runes: path.join(cacheDir, "runes-reforged.json"),
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeDataDragonName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s.'-]/g, "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return String(error);
}

const FALLBACK_RUNE_STYLE_IDS: Record<string, number> = {
  precision: 8000,
  domination: 8100,
  sorcery: 8200,
  inspiration: 8300,
  resolve: 8400,
};
