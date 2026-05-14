import { detectChampionSelect } from "./champSelect.js";
import { LeagueClientApi } from "./lcuClient.js";
import { getLeagueClientConnectionInfo, type FindLeagueLockfileOptions } from "./lockfile.js";
import { setRunePageDuringChampionSelect, type SetRunePageResult } from "./runes.js";
import { setSummonerSpellsDuringChampionSelect, type SetSummonerSpellsResult } from "./summonerSpells.js";
import { RecommendationProvider, type RecommendationProviderOptions } from "../recommendations/RecommendationProvider.js";
import { isChampionRole, type ChampionRole } from "../models/domain.js";

export type ApplyRecommendationInput = {
  champion: string;
  role: ChampionRole;
};

export type ApplyRecommendationOptions = {
  lockfile?: FindLeagueLockfileOptions;
  recommendations?: RecommendationProviderOptions;
};

export type ApplyRecommendationResult = {
  success: true;
  champion: string;
  role: ChampionRole;
  leagueClientConnected: boolean;
  isInChampionSelect: boolean;
  championId: number | null;
  summonerId: number;
  runes: SetRunePageResult;
  summonerSpells: SetSummonerSpellsResult;
};

export class ApplyRecommendationError extends Error {
  readonly code:
    | "INVALID_ROLE"
    | "LEAGUE_CLIENT_UNAVAILABLE"
    | "NOT_IN_CHAMP_SELECT"
    | "RECOMMENDATION_LOAD_FAILED"
    | "RUNES_APPLY_FAILED"
    | "SUMMONER_SPELLS_APPLY_FAILED";
  readonly details?: unknown;

  constructor(code: ApplyRecommendationError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "ApplyRecommendationError";
    this.code = code;
    this.details = details;
  }
}

export async function applyRecommendationToLeague(
  input: ApplyRecommendationInput,
  options: ApplyRecommendationOptions = {},
): Promise<ApplyRecommendationResult> {
  if (!isChampionRole(input.role)) {
    throw new ApplyRecommendationError("INVALID_ROLE", `Unsupported champion role: ${input.role}`, {
      role: input.role,
    });
  }

  let lcu: LeagueClientApi;

  try {
    const connectionInfo = await getLeagueClientConnectionInfo(options.lockfile);
    lcu = LeagueClientApi.fromLockfile(connectionInfo);
  } catch (error) {
    throw new ApplyRecommendationError("LEAGUE_CLIENT_UNAVAILABLE", "League Client is not available.", {
      cause: formatUnknownError(error),
    });
  }

  const detection = await detectChampionSelect(lcu);

  if (!detection.isInChampionSelect) {
    throw new ApplyRecommendationError("NOT_IN_CHAMP_SELECT", "Champion select is not active.", {
      gameflowPhase: detection.gameflowPhase,
    });
  }

  const provider = new RecommendationProvider(options.recommendations);
  const recommendation = await provider.getRecommendation(input.champion, input.role).catch((error: unknown) => {
    throw new ApplyRecommendationError("RECOMMENDATION_LOAD_FAILED", "Could not load build recommendation.", {
      champion: input.champion,
      role: input.role,
      cause: formatUnknownError(error),
    });
  });

  const runes = await setRunePageDuringChampionSelect(lcu, {
    champion: recommendation.champion,
    role: recommendation.matchedRole,
    primaryStyle: recommendation.runes.primaryStyle,
    subStyle: recommendation.runes.subStyle,
    selectedPerkIds: recommendation.runes.selectedPerkIds,
  }).catch((error: unknown) => {
    throw new ApplyRecommendationError("RUNES_APPLY_FAILED", "Could not apply rune page.", {
      cause: formatUnknownError(error),
    });
  });

  const summonerSpells = await setSummonerSpellsDuringChampionSelect(lcu, {
    spell1Id: recommendation.summonerSpells.ids[0],
    spell2Id: recommendation.summonerSpells.ids[1],
  }).catch((error: unknown) => {
    throw new ApplyRecommendationError("SUMMONER_SPELLS_APPLY_FAILED", "Could not apply summoner spells.", {
      cause: formatUnknownError(error),
    });
  });

  return {
    success: true,
    champion: recommendation.champion,
    role: recommendation.matchedRole,
    leagueClientConnected: true,
    isInChampionSelect: true,
    championId: detection.championId > 0 ? detection.championId : null,
    summonerId: detection.summonerId,
    runes,
    summonerSpells,
  };
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
