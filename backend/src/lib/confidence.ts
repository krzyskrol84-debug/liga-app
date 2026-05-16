export type ConfidenceScore = "high" | "medium" | "low";

export const MIN_RECOMMENDATION_GAMES = 20;
export const MIN_ITEM_GAMES = 20;
export const MIN_MATCHUP_GAMES = 10;

export function getConfidence(gamesCount: number, minimumGames: number) {
  const lowConfidence = gamesCount < minimumGames;
  const confidenceScore: ConfidenceScore =
    lowConfidence ? "low" : gamesCount < minimumGames * 5 ? "medium" : "high";

  return {
    lowConfidence,
    confidenceScore,
  };
}
