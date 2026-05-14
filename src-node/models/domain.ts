export type ChampionRole = "top" | "jungle" | "middle" | "bottom" | "utility";

export type PatchVersion = string;

export type Champion = {
  championId: number;
  key: string;
  name: string;
  title?: string;
  roles: ChampionRole[];
  imageUrl?: string;
  patch: PatchVersion;
};

export type RuneShardId = 5001 | 5002 | 5003 | 5005 | 5007 | 5008 | 5011 | number;

export type RuneSelection = {
  id: number;
  name?: string;
  iconUrl?: string;
};

export type RuneStyle = {
  id: number;
  key: string;
  name: string;
  iconUrl?: string;
};

export type RunePage = {
  id?: number;
  name: string;
  championId: number;
  role: ChampionRole;
  patch: PatchVersion;
  primaryStyle: RuneStyle;
  secondaryStyle: RuneStyle;
  primaryRunes: RuneSelection[];
  secondaryRunes: RuneSelection[];
  statShards: [RuneShardId, RuneShardId, RuneShardId];
  selectedPerkIds: number[];
};

export type SummonerSpell = {
  id: number;
  key: string;
  name: string;
  description?: string;
  iconUrl?: string;
  cooldownSeconds?: number;
  modes?: string[];
  patch: PatchVersion;
};

export type ChampionStats = {
  championId: number;
  role: ChampionRole;
  patch: PatchVersion;
  winRate: number;
  pickRate: number;
  gamesCount: number;
  source?: "local" | "manual" | "imported";
  updatedAt?: string;
};

export type ItemBuild = {
  start: string[];
  core: string[];
  situational?: string[];
  boots?: string[];
};

export type SkillOrder = {
  priority: Array<"Q" | "W" | "E">;
  levels?: string[];
};

export type BuildRecommendation = {
  champion: Champion;
  championId: number;
  role: ChampionRole;
  patch: PatchVersion;
  stats: ChampionStats;
  runes: RunePage;
  summonerSpells: [SummonerSpell, SummonerSpell];
  items?: ItemBuild;
  skillOrder?: SkillOrder;
  confidence?: number;
  notes?: string[];
};

export function createSelectedPerkIds(runePage: Pick<RunePage, "primaryRunes" | "secondaryRunes" | "statShards">) {
  return [
    ...runePage.primaryRunes.map((rune) => rune.id),
    ...runePage.secondaryRunes.map((rune) => rune.id),
    ...runePage.statShards,
  ];
}

export function isChampionRole(value: string): value is ChampionRole {
  return ["top", "jungle", "middle", "bottom", "utility"].includes(value);
}

export function formatRate(value: number): string {
  return `${value.toFixed(1)}%`;
}
