import type { ChampionRole } from "../models/domain.js";
import { isChampionRole } from "../models/domain.js";
import {
  getChampionByName,
  getPerkStylesForRunes,
  getRuneByName,
  getSummonerSpellByNameOrId,
  type DataDragonData,
} from "../riot/dataDragon.js";
import type { RecommendationJsonEntry } from "../recommendations/RecommendationProvider.js";

export type ParsedBuildImport = {
  champion: string;
  championId: number;
  role: ChampionRole;
  primaryStyleId: number;
  subStyleId: number;
  primaryStyle: string;
  subStyle: string;
  selectedPerkIds: number[];
  summonerSpellIds: [number, number];
  winRate: number;
  pickRate: number;
  gamesCount: number;
  patch: string;
};

export class BuildImportError extends Error {
  readonly code:
    | "MISSING_FIELD"
    | "INVALID_ROLE"
    | "UNKNOWN_CHAMPION"
    | "UNKNOWN_RUNE"
    | "UNKNOWN_SUMMONER"
    | "INVALID_WIN_RATE";
  readonly details?: unknown;

  constructor(code: BuildImportError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "BuildImportError";
    this.code = code;
    this.details = details;
  }
}

export function parseBuildImportText(
  input: string,
  dataDragon: DataDragonData,
  options: { patch?: string; pickRate?: number; gamesCount?: number } = {},
): ParsedBuildImport {
  const fields = parseFields(input);
  const championName = requireField(fields, "champion");
  const champion = getChampionByName(dataDragon, championName);

  if (!champion) {
    throw new BuildImportError("UNKNOWN_CHAMPION", `Unknown champion: ${championName}`, { championName });
  }

  const rawRole = normalizeRole(requireField(fields, "role"));
  if (!isChampionRole(rawRole)) {
    throw new BuildImportError("INVALID_ROLE", `Unsupported role: ${rawRole}`, { role: rawRole });
  }

  const runeNames = splitList(requireField(fields, "runes"));
  if (runeNames.length < 6) {
    throw new BuildImportError("UNKNOWN_RUNE", "Build import requires at least six runes.", { runeNames });
  }

  const selectedRunes = runeNames.map((name) => requireRuneByName(dataDragon, name));
  const [primaryStyle, subStyle] = requireStylesForRunes(dataDragon, selectedRunes.map((rune) => rune.id));
  const summonerSpellIds = splitList(requireField(fields, "summoners")).map((name) =>
    requireSummonerSpellId(dataDragon, name),
  );

  if (summonerSpellIds.length !== 2) {
    throw new BuildImportError("UNKNOWN_SUMMONER", "Build import requires exactly two summoner spells.", {
      summonerSpellIds,
    });
  }

  return {
    champion: champion.name,
    championId: Number(champion.key),
    role: rawRole,
    primaryStyleId: primaryStyle.id,
    subStyleId: subStyle.id,
    primaryStyle: primaryStyle.name,
    subStyle: subStyle.name,
    selectedPerkIds: selectedRunes.map((rune) => rune.id),
    summonerSpellIds: [summonerSpellIds[0], summonerSpellIds[1]],
    winRate: parsePercent(requireField(fields, "win rate")),
    pickRate: options.pickRate ?? parseOptionalPercent(fields.get("pick rate")) ?? 0,
    gamesCount: options.gamesCount ?? parseOptionalInteger(fields.get("games count")) ?? 0,
    patch: options.patch ?? dataDragon.version,
  };
}

export function toRecommendationJsonEntry(build: ParsedBuildImport): RecommendationJsonEntry {
  return {
    championId: build.championId,
    champion: build.champion,
    role: build.role,
    primaryStyle: build.primaryStyle,
    primaryStyleId: build.primaryStyleId,
    subStyle: build.subStyle,
    subStyleId: build.subStyleId,
    selectedPerkIds: build.selectedPerkIds,
    summonerSpellIds: build.summonerSpellIds,
    winRate: build.winRate,
    pickRate: build.pickRate,
    gamesCount: build.gamesCount,
    patch: build.patch,
  };
}

function parseFields(input: string): Map<string, string> {
  const fields = new Map<string, string>();

  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    fields.set(normalizeField(match[1]), match[2].trim());
  }

  return fields;
}

function requireField(fields: Map<string, string>, name: string): string {
  const value = fields.get(normalizeField(name));
  if (!value) {
    throw new BuildImportError("MISSING_FIELD", `Missing build import field: ${name}`, { name });
  }
  return value;
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function requireRuneByName(dataDragon: DataDragonData, name: string) {
  const rune = getRuneByName(dataDragon, name);

  if (!rune) {
    throw new BuildImportError("UNKNOWN_RUNE", `Unknown rune: ${name}`, { name });
  }

  return rune;
}

function requireStylesForRunes(dataDragon: DataDragonData, selectedPerkIds: number[]) {
  const matchedStyles = getPerkStylesForRunes(dataDragon, selectedPerkIds);

  if (matchedStyles.length < 2) {
    throw new BuildImportError("UNKNOWN_RUNE", "Could not resolve primary and secondary rune styles.", {
      selectedPerkIds,
    });
  }

  return [matchedStyles[0], matchedStyles[1]] as const;
}

function requireSummonerSpellId(dataDragon: DataDragonData, name: string): number {
  const spell = getSummonerSpellByNameOrId(dataDragon, name);

  if (!spell) {
    throw new BuildImportError("UNKNOWN_SUMMONER", `Unknown summoner spell: ${name}`, { name });
  }

  return Number(spell.key);
}

function parsePercent(value: string): number {
  const parsed = Number(value.replace("%", "").trim());
  if (!Number.isFinite(parsed)) {
    throw new BuildImportError("INVALID_WIN_RATE", `Invalid percent value: ${value}`, { value });
  }
  return parsed;
}

function parseOptionalPercent(value: string | undefined): number | null {
  return value ? parsePercent(value) : null;
}

function parseOptionalInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[,\s]/g, ""));
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeField(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRole(value: string): string {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    mid: "middle",
    adc: "bottom",
    bot: "bottom",
    support: "utility",
    sup: "utility",
  };
  return aliases[normalized] ?? normalized;
}
