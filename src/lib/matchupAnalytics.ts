type Role = "top" | "jungle" | "middle" | "bottom" | "utility";

type RecommendationLike = {
  champion: string;
  role: Role;
  label?: string;
  winRate: number;
  pickRate: number;
  gamesCount: number;
};

export type AnalyticsEntry = {
  champion: string;
  role: Role;
  winRate: number;
  pickRate: number;
  gamesCount: number;
  label?: string;
};

export type MatchupAnalytics = {
  toughestMatchups: AnalyticsEntry[];
  bestPicks: AnalyticsEntry[];
  worstPicks: AnalyticsEntry[];
};

export function buildMatchupAnalytics(
  recommendations: RecommendationLike[],
  champion: string,
  role: Role,
): MatchupAnalytics {
  const sameRole = dedupeByChampion(recommendations.filter((item) => item.role === role)).sort(compareByStrength);
  const selected = recommendations
    .filter((item) => item.champion === champion && item.role === role)
    .sort(compareByStrength)[0];

  const bestPicks = sameRole.slice(0, 5);
  const worstPicks = [...sameRole].sort(compareByWeakness).slice(0, 5);
  const toughestMatchups = selected
    ? sameRole
        .filter((item) => item.champion !== champion && item.winRate > selected.winRate)
        .sort((a, b) => b.winRate - a.winRate || b.pickRate - a.pickRate)
        .slice(0, 5)
    : [];

  return { toughestMatchups, bestPicks, worstPicks };
}

function dedupeByChampion(entries: RecommendationLike[]): AnalyticsEntry[] {
  const bestByChampion = new Map<string, AnalyticsEntry>();

  for (const entry of entries) {
    const current = bestByChampion.get(entry.champion);
    if (!current || compareByStrength(entry, current) < 0) {
      bestByChampion.set(entry.champion, { ...entry });
    }
  }

  return [...bestByChampion.values()];
}

function compareByStrength(a: RecommendationLike, b: RecommendationLike): number {
  return b.winRate - a.winRate || b.pickRate - a.pickRate || b.gamesCount - a.gamesCount;
}

function compareByWeakness(a: RecommendationLike, b: RecommendationLike): number {
  return a.winRate - b.winRate || a.pickRate - b.pickRate || a.gamesCount - b.gamesCount;
}
