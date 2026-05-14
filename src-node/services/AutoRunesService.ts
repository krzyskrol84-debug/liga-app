import { setRunePageDuringChampionSelect } from "../league/runes.js";
import type { LeagueClientApi } from "../league/lcuClient.js";
import type { BuildRecommendation } from "../models/appModels.js";

export class AutoRunesService {
  private appliedKey: string | null = null;

  constructor(private readonly lcu: LeagueClientApi) {}

  async apply(recommendation: BuildRecommendation, enabled: boolean) {
    if (!enabled) return { skipped: true, reason: "disabled" };

    const key = [
      recommendation.buildId ?? `${recommendation.championId}:${recommendation.role}`,
      recommendation.patch,
      recommendation.primaryStyleId,
      recommendation.subStyleId,
      recommendation.selectedPerkIds.join("-"),
    ].join(":");
    if (this.appliedKey === key) return { skipped: true, reason: "already_applied" };

    const result = await setRunePageDuringChampionSelect(this.lcu, {
      champion: recommendation.championName,
      role: recommendation.role.toUpperCase(),
      primaryStyle: styleName(recommendation.primaryStyleId),
      subStyle: styleName(recommendation.subStyleId),
      selectedPerkIds: recommendation.selectedPerkIds,
    });
    this.appliedKey = key;
    return result;
  }
}

function styleName(styleId: number): string {
  const styles: Record<number, string> = {
    8000: "Precision",
    8100: "Domination",
    8200: "Sorcery",
    8300: "Inspiration",
    8400: "Resolve",
  };
  return styles[styleId] ?? String(styleId);
}
