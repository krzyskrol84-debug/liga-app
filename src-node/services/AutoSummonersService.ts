import { setSummonerSpellsDuringChampionSelect } from "../league/summonerSpells.js";
import type { LeagueClientApi } from "../league/lcuClient.js";
import type { BuildRecommendation } from "../models/appModels.js";

export class AutoSummonersService {
  private appliedKey: string | null = null;

  constructor(private readonly lcu: LeagueClientApi) {}

  async apply(recommendation: BuildRecommendation, enabled: boolean) {
    if (!enabled) return { skipped: true, reason: "disabled" };

    const key = [
      recommendation.buildId ?? `${recommendation.championId}:${recommendation.role}`,
      recommendation.patch,
      recommendation.summonerSpellIds.join("-"),
    ].join(":");
    if (this.appliedKey === key) return { skipped: true, reason: "already_applied" };

    const result = await setSummonerSpellsDuringChampionSelect(this.lcu, {
      spell1Id: recommendation.summonerSpellIds[0],
      spell2Id: recommendation.summonerSpellIds[1],
    });
    this.appliedKey = key;
    return result;
  }
}
