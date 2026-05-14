import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isChampionRole, type ChampionRole } from "../models/domain.js";
import {
  getChampionByKey,
  getChampionByName,
  getPerkStyleIdByName,
  getRuneById,
  getSummonerSpellByKey,
  isKnownStatShard,
  normalizeDataDragonName,
  type DataDragonData,
} from "../riot/dataDragon.js";

export type RecommendationJsonEntry = {
  buildId?: string;
  label?: string;
  championId?: number;
  champion: string;
  role: ChampionRole;
  fallback?: boolean;
  primaryStyle: string;
  primaryStyleId?: number;
  subStyle: string;
  subStyleId?: number;
  selectedPerkIds: number[];
  summonerSpellIds: [number, number];
  winRate: number;
  pickRate: number;
  gamesCount: number;
  patch: string;
};

export type RecommendationResult = {
  buildId: string | null;
  label: string | null;
  championId: number | null;
  champion: string;
  requestedRole: ChampionRole;
  matchedRole: ChampionRole;
  patch: string;
  source: "local-json";
  runes: {
    primaryStyle: string;
    primaryStyleId: number | null;
    subStyle: string;
    subStyleId: number | null;
    selectedPerkIds: number[];
  };
  summonerSpells: {
    ids: [number, number];
  };
  stats: {
    winRate: number;
    pickRate: number;
    gamesCount: number;
  };
  warnings: string[];
  isExactRoleMatch: boolean;
  isFallback: boolean;
};

export type RecommendationProviderOptions = {
  recommendationsPath?: string;
  dataDragon?: DataDragonData;
};

export const DATA_DRAGON_CURRENT_PATCH = "data-dragon-current";

export class RecommendationProviderError extends Error {
  readonly code:
    | "RECOMMENDATIONS_READ_FAILED"
    | "RECOMMENDATIONS_INVALID_JSON"
    | "RECOMMENDATIONS_INVALID_ENTRY"
    | "INVALID_ROLE"
    | "RECOMMENDATION_NOT_FOUND";
  readonly details?: unknown;

  constructor(code: RecommendationProviderError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "RecommendationProviderError";
    this.code = code;
    this.details = details;
  }
}

export class RecommendationProvider {
  private readonly recommendationsPath: string;
  private readonly dataDragon?: DataDragonData;
  private cache: RecommendationJsonEntry[] | null = null;
  private championCache = new Map<string, RecommendationJsonEntry[]>();
  private resolvedRecommendationCache = new Map<string, RecommendationResult>();
  private resolvedRecommendationsCache = new Map<string, RecommendationResult[]>();

  constructor(options: RecommendationProviderOptions = {}) {
    this.recommendationsPath = options.recommendationsPath ?? getDefaultRecommendationsPath();
    this.dataDragon = options.dataDragon;
  }

  async getRecommendation(champion: string | number, role: ChampionRole | string): Promise<RecommendationResult> {
    const requestedRole = normalizeRecommendationRole(role);

    if (!requestedRole) {
      throw new RecommendationProviderError("INVALID_ROLE", `Unsupported champion role: ${role}`, { role });
    }

    const cacheKey = buildResolutionCacheKey(champion, requestedRole, "best");
    const cached = this.resolvedRecommendationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const championRecommendations = await this.getChampionRecommendations(champion);

    const exactRoleMatch = championRecommendations
      .filter((entry) => entry.role === requestedRole)
      .sort(compareRecommendations)[0];

    if (exactRoleMatch) {
      const result = toRecommendationResult(exactRoleMatch, requestedRole, true, false, this.dataDragon);
      this.resolvedRecommendationCache.set(cacheKey, result);
      return result;
    }

    const bestFallbackMatch =
      championRecommendations.filter((entry) => entry.fallback).sort(compareRecommendations)[0] ??
      championRecommendations.sort(compareRecommendations)[0];

    if (bestFallbackMatch) {
      const result = toRecommendationResult(bestFallbackMatch, requestedRole, false, true, this.dataDragon);
      this.resolvedRecommendationCache.set(cacheKey, result);
      return result;
    }

    throw new RecommendationProviderError(
      "RECOMMENDATION_NOT_FOUND",
      `No recommendation found for champion: ${champion}`,
      { champion, role },
    );
  }

  async getRecommendations(champion: string | number, role: ChampionRole | string): Promise<RecommendationResult[]> {
    const requestedRole = normalizeRecommendationRole(role);

    if (!requestedRole) {
      throw new RecommendationProviderError("INVALID_ROLE", `Unsupported champion role: ${role}`, { role });
    }

    const cacheKey = buildResolutionCacheKey(champion, requestedRole, "all");
    const cached = this.resolvedRecommendationsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const championRecommendations = await this.getChampionRecommendations(champion);
    const exactRoleMatches = championRecommendations
      .filter((entry) => entry.role === requestedRole)
      .sort(compareRecommendations);

    if (exactRoleMatches.length > 0) {
      const results = exactRoleMatches.map((entry) =>
        toRecommendationResult(entry, requestedRole, true, false, this.dataDragon),
      );
      this.resolvedRecommendationsCache.set(cacheKey, results);
      return results;
    }

    const fallbackMatches = championRecommendations.filter((entry) => entry.fallback).sort(compareRecommendations);
    const fallbackPool = fallbackMatches.length > 0 ? fallbackMatches : championRecommendations.sort(compareRecommendations);

    if (fallbackPool.length > 0) {
      const results = fallbackPool.map((entry) =>
        toRecommendationResult(entry, requestedRole, false, true, this.dataDragon),
      );
      this.resolvedRecommendationsCache.set(cacheKey, results);
      return results;
    }

    throw new RecommendationProviderError(
      "RECOMMENDATION_NOT_FOUND",
      `No recommendations found for champion: ${champion}`,
      { champion, role },
    );
  }

  async loadRecommendations(): Promise<RecommendationJsonEntry[]> {
    if (this.cache) {
      return this.cache;
    }

    let raw: string;

    try {
      raw = await readFile(this.recommendationsPath, "utf8");
    } catch (error) {
      throw new RecommendationProviderError(
        "RECOMMENDATIONS_READ_FAILED",
        `Could not read recommendations file: ${this.recommendationsPath}`,
        { path: this.recommendationsPath, cause: formatUnknownError(error) },
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new RecommendationProviderError(
        "RECOMMENDATIONS_INVALID_JSON",
        `Recommendations file contains invalid JSON: ${this.recommendationsPath}`,
        { path: this.recommendationsPath, cause: formatUnknownError(error) },
      );
    }

    if (!Array.isArray(parsed)) {
      throw new RecommendationProviderError(
        "RECOMMENDATIONS_INVALID_JSON",
        "Recommendations file must contain an array.",
        { path: this.recommendationsPath },
      );
    }

    this.cache = parsed.map((entry, index) => validateRecommendationEntry(entry, index));
    return this.cache;
  }

  clearCache(): void {
    this.cache = null;
    this.championCache.clear();
    this.resolvedRecommendationCache.clear();
    this.resolvedRecommendationsCache.clear();
  }

  async refreshRecommendationsForPatch(patch: string): Promise<RecommendationResult[]> {
    const recommendations = await this.loadRecommendations();
    return recommendations
      .map((entry) => ({ ...entry, patch }))
      .map((entry) => toRecommendationResult(entry, entry.role, true, false, this.dataDragon));
  }

  private async getChampionRecommendations(champion: string | number): Promise<RecommendationJsonEntry[]> {
    await this.loadRecommendations();
    const championKey = buildChampionCacheKey(champion);
    const cached = this.championCache.get(championKey);
    if (cached) {
      return cached;
    }

    const championRecommendations = this.cache!.filter((entry) => matchesChampion(entry, champion));
    this.championCache.set(championKey, championRecommendations);
    return championRecommendations;
  }
}

export function createRecommendationProvider(options?: RecommendationProviderOptions): RecommendationProvider {
  return new RecommendationProvider(options);
}

export async function getRecommendation(
  champion: string | number,
  role: ChampionRole | string,
  options?: RecommendationProviderOptions,
): Promise<RecommendationResult> {
  return new RecommendationProvider(options).getRecommendation(champion, role);
}

export async function getRecommendations(
  champion: string | number,
  role: ChampionRole | string,
  options?: RecommendationProviderOptions,
): Promise<RecommendationResult[]> {
  return new RecommendationProvider(options).getRecommendations(champion, role);
}

function validateRecommendationEntry(entry: unknown, index: number): RecommendationJsonEntry {
  if (!isRecord(entry)) {
    throw invalidEntry(index, "Entry must be an object.", entry);
  }

  assertString(entry.champion, index, "champion");
  assertString(entry.primaryStyle, index, "primaryStyle");
  assertString(entry.subStyle, index, "subStyle");
  if (typeof entry.patch !== "string") {
    throw invalidEntry(index, "Entry patch must be a string.", { patch: entry.patch });
  }

  const normalizedRole = typeof entry.role === "string" ? normalizeRecommendationRole(entry.role) : null;
  if (!normalizedRole) {
    throw invalidEntry(index, "Entry has invalid role.", { role: entry.role });
  }

  if (!isNumberArray(entry.selectedPerkIds) || entry.selectedPerkIds.length === 0) {
    throw invalidEntry(index, "Entry selectedPerkIds must be a non-empty number array.", {
      selectedPerkIds: entry.selectedPerkIds,
    });
  }

  if (!isTwoNumberTuple(entry.summonerSpellIds)) {
    throw invalidEntry(index, "Entry summonerSpellIds must contain exactly two numbers.", {
      summonerSpellIds: entry.summonerSpellIds,
    });
  }

  assertFiniteNumber(entry.winRate, index, "winRate");
  assertFiniteNumber(entry.pickRate, index, "pickRate");
  assertFiniteNumber(entry.gamesCount, index, "gamesCount");

  return {
    buildId: optionalString(entry.buildId),
    label: optionalString(entry.label),
    championId: optionalNumber(entry.championId),
    champion: entry.champion,
    role: normalizedRole,
    fallback: optionalBoolean(entry.fallback),
    primaryStyle: entry.primaryStyle,
    primaryStyleId: optionalNumber(entry.primaryStyleId),
    subStyle: entry.subStyle,
    subStyleId: optionalNumber(entry.subStyleId),
    selectedPerkIds: entry.selectedPerkIds,
    summonerSpellIds: entry.summonerSpellIds,
    winRate: entry.winRate,
    pickRate: entry.pickRate,
    gamesCount: entry.gamesCount,
    patch: entry.patch.trim() || DATA_DRAGON_CURRENT_PATCH,
  };
}

function toRecommendationResult(
  entry: RecommendationJsonEntry,
  requestedRole: ChampionRole,
  isExactRoleMatch: boolean,
  isFallback: boolean,
  dataDragon?: DataDragonData,
): RecommendationResult {
  const normalizedEntry = normalizeRecommendationEntry(entry, dataDragon);
  const warnings = [
    ...buildNormalizationWarnings(entry, normalizedEntry),
    ...validateAgainstDataDragon(normalizedEntry, dataDragon),
  ];

  return {
    buildId: normalizedEntry.buildId ?? null,
    label: normalizedEntry.label ?? null,
    championId:
      normalizedEntry.championId ??
      dataDragonChampionId(normalizedEntry, dataDragon) ??
      knownChampionId(normalizedEntry.champion),
    champion: normalizedEntry.champion,
    requestedRole,
    matchedRole: normalizedEntry.role,
    patch: normalizedEntry.patch,
    source: "local-json",
    runes: {
      primaryStyle: normalizedEntry.primaryStyle,
      primaryStyleId: normalizedEntry.primaryStyleId ?? getPerkStyleIdByName(normalizedEntry.primaryStyle, dataDragon),
      subStyle: normalizedEntry.subStyle,
      subStyleId: normalizedEntry.subStyleId ?? getPerkStyleIdByName(normalizedEntry.subStyle, dataDragon),
      selectedPerkIds: normalizedEntry.selectedPerkIds,
    },
    summonerSpells: {
      ids: normalizedEntry.summonerSpellIds,
    },
    stats: {
      winRate: normalizedEntry.winRate,
      pickRate: normalizedEntry.pickRate,
      gamesCount: normalizedEntry.gamesCount,
    },
    warnings,
    isExactRoleMatch,
    isFallback,
  };
}

function compareRecommendations(a: RecommendationJsonEntry, b: RecommendationJsonEntry): number {
  const winRateDiff = b.winRate - a.winRate;

  if (winRateDiff !== 0) {
    return winRateDiff;
  }

  return b.gamesCount - a.gamesCount;
}

function getDefaultRecommendationsPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../../data/recommendations.json");
}

function normalizeChampionName(value: string): string {
  return normalizeDataDragonName(value);
}

function matchesChampion(entry: RecommendationJsonEntry, champion: string | number): boolean {
  if (typeof champion === "number") {
    return entry.championId === champion || knownChampionId(entry.champion) === champion;
  }

  return normalizeChampionName(entry.champion) === normalizeChampionName(champion);
}

function knownChampionId(champion: string): number | null {
  return KNOWN_CHAMPION_IDS[normalizeChampionName(champion)] ?? null;
}

function buildChampionCacheKey(champion: string | number): string {
  return typeof champion === "number" ? `id:${champion}` : `name:${normalizeChampionName(champion)}`;
}

function buildResolutionCacheKey(
  champion: string | number,
  role: ChampionRole,
  mode: "best" | "all",
): string {
  return `${mode}:${buildChampionCacheKey(champion)}:${role}`;
}

function normalizeRecommendationRole(role: string): ChampionRole | null {
  const normalized = normalizeDataDragonName(role);
  const aliases: Record<string, ChampionRole> = {
    top: "top",
    jungle: "jungle",
    jg: "jungle",
    jungler: "jungle",
    mid: "middle",
    middle: "middle",
    adc: "bottom",
    bot: "bottom",
    bottom: "bottom",
    support: "utility",
    supp: "utility",
    sup: "utility",
    utility: "utility",
  };

  const canonical = aliases[normalized] ?? normalized;
  return isChampionRole(canonical) ? canonical : null;
}

function dataDragonChampionId(entry: RecommendationJsonEntry, dataDragon?: DataDragonData): number | null {
  if (!dataDragon) {
    return null;
  }

  if (entry.championId) {
    const byKey = getChampionByKey(dataDragon, entry.championId);
    if (byKey) {
      return Number(byKey.key);
    }
  }

  const byName = getChampionByName(dataDragon, entry.champion);
  return byName ? Number(byName.key) : null;
}

function validateAgainstDataDragon(entry: RecommendationJsonEntry, dataDragon?: DataDragonData): string[] {
  const warnings: string[] = [];
  if (!dataDragon) {
    return warnings;
  }

  const championExists =
    (entry.championId ? Boolean(getChampionByKey(dataDragon, entry.championId)) : false) ||
    Boolean(getChampionByName(dataDragon, entry.champion));

  if (!championExists) {
    warnings.push(`Champion ${entry.champion} does not exist in Data Dragon ${dataDragon.version}.`);
  }

  for (const perkId of entry.selectedPerkIds) {
    if (!getRuneById(dataDragon, perkId) && !isKnownStatShard(perkId)) {
      warnings.push(`Rune ${perkId} does not exist in Data Dragon ${dataDragon.version}.`);
    }
  }

  for (const spellId of entry.summonerSpellIds) {
    if (!getSummonerSpellByKey(dataDragon, spellId)) {
      warnings.push(`Summoner spell ${spellId} does not exist in Data Dragon ${dataDragon.version}.`);
    }
  }

  return warnings;
}

function buildNormalizationWarnings(
  originalEntry: RecommendationJsonEntry,
  normalizedEntry: RecommendationJsonEntry,
): string[] {
  const warnings: string[] = [];

  for (const perkId of originalEntry.selectedPerkIds) {
    const replacement = DEPRECATED_RUNE_ID_REPLACEMENTS[perkId];
    if (replacement) {
      warnings.push(`Rune ${perkId} is deprecated and was replaced with ${replacement}.`);
    }
  }

  if (normalizedEntry.selectedPerkIds.length !== originalEntry.selectedPerkIds.length) {
    warnings.push(`One or more invalid rune IDs were removed from build ${originalEntry.buildId ?? originalEntry.champion}.`);
  }

  return warnings;
}

function normalizeRecommendationEntry(
  entry: RecommendationJsonEntry,
  dataDragon?: DataDragonData,
): RecommendationJsonEntry {
  if (!dataDragon) {
    return {
      ...entry,
      selectedPerkIds: entry.selectedPerkIds.map((perkId) => DEPRECATED_RUNE_ID_REPLACEMENTS[perkId] ?? perkId),
    };
  }

  const selectedPerkIds = entry.selectedPerkIds
    .map((perkId) => DEPRECATED_RUNE_ID_REPLACEMENTS[perkId] ?? perkId)
    .filter((perkId) => getRuneById(dataDragon, perkId) || isKnownStatShard(perkId));

  return {
    ...entry,
    selectedPerkIds: selectedPerkIds.length > 0 ? selectedPerkIds : FALLBACK_SELECTED_PERK_IDS,
  };
}

function optionalNumber(value: unknown): number | undefined {
  return Number.isFinite(value) ? Number(value) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isFinite(item));
}

function isTwoNumberTuple(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => Number.isFinite(item));
}

function assertString(value: unknown, index: number, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidEntry(index, `Entry ${field} must be a non-empty string.`, { [field]: value });
  }
}

function assertFiniteNumber(value: unknown, index: number, field: string): asserts value is number {
  if (!Number.isFinite(value)) {
    throw invalidEntry(index, `Entry ${field} must be a finite number.`, { [field]: value });
  }
}

function invalidEntry(index: number, message: string, details?: unknown): RecommendationProviderError {
  return new RecommendationProviderError("RECOMMENDATIONS_INVALID_ENTRY", message, {
    index,
    details,
  });
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

const KNOWN_CHAMPION_IDS: Record<string, number> = {
  ahri: 103,
  darius: 122,
  lux: 99,
  jinx: 222,
  leesin: 64,
  yasuo: 157,
  garen: 86,
  caitlyn: 51,
  thresh: 412,
  leona: 89,
  akali: 84,
  ezreal: 81,
  vi: 254,
  riven: 92,
  orianna: 61,
  nami: 267,
  kaisa: 145,
  viego: 234,
  malphite: 54,
  syndra: 134,
  naafiri: 950,
};

const DEPRECATED_RUNE_ID_REPLACEMENTS: Record<number, number> = {
  8138: 8135,
};

const FALLBACK_SELECTED_PERK_IDS = [8112, 8139, 8135, 8106, 8226, 8236, 5008, 5008, 5011];
