import { invoke } from "@tauri-apps/api/core";

export type PatchRecord = {
  version: string;
  isCurrent: boolean;
  releasedAt?: string | null;
};

export type ChampionRecord = {
  championId: number;
  championKey: string;
  name: string;
  title?: string | null;
  roles: string[];
  imageUrl?: string | null;
  patch: string;
};

export type RecommendationRecord = {
  id?: number | null;
  championId: number;
  role: "top" | "jungle" | "middle" | "bottom" | "utility";
  primaryStyle: string;
  subStyle: string;
  selectedPerkIds: number[];
  summonerSpellIds: [number, number];
  winRate: number;
  pickRate: number;
  gamesCount: number;
  patch: string;
  source?: string | null;
};

export type SettingRecord = {
  key: string;
  value: unknown;
  valueType: string;
};

export type HistoryRecord = {
  id?: number | null;
  championId?: number | null;
  championName: string;
  role: string;
  patch: string;
  action: string;
  success: boolean;
  message?: string | null;
  recommendation?: unknown;
  createdAt?: string | null;
};

export type AppLogRecord = {
  id?: number | null;
  level: "debug" | "info" | "warn" | "error" | string;
  category: string;
  message: string;
  context?: unknown;
  createdAt?: string | null;
};

export type DatabaseInfo = {
  path: string;
  migrations: Array<{
    version: number;
    name: string;
    appliedAt: string;
  }>;
};

export function getDatabaseInfo() {
  return invoke<DatabaseInfo>("get_database_info");
}

export function upsertPatch(patch: PatchRecord) {
  return invoke<void>("upsert_patch", { patch });
}

export function listPatches() {
  return invoke<PatchRecord[]>("list_patches");
}

export function upsertChampion(champion: ChampionRecord) {
  return invoke<void>("upsert_champion", { champion });
}

export function listChampions() {
  return invoke<ChampionRecord[]>("list_champions");
}

export function getChampion(championId: number) {
  return invoke<ChampionRecord | null>("get_champion", { championId });
}

export function upsertRecommendation(recommendation: RecommendationRecord) {
  return invoke<void>("upsert_recommendation", { recommendation });
}

export function listRecommendations(filters: { championId?: number; role?: string } = {}) {
  return invoke<RecommendationRecord[]>("list_recommendations", filters);
}

export function setSetting(setting: SettingRecord) {
  return invoke<void>("set_setting", { setting });
}

export function getSetting(key: string) {
  return invoke<SettingRecord | null>("get_setting", { key });
}

export function listSettings() {
  return invoke<SettingRecord[]>("list_settings");
}

export function addHistory(history: HistoryRecord) {
  return invoke<number>("add_history", { history });
}

export function listHistory(limit = 50) {
  return invoke<HistoryRecord[]>("list_history", { limit });
}

export function writeAppLog(log: AppLogRecord) {
  return invoke<number>("write_app_log", { log });
}

export function listAppLogs(filters: { limit?: number; level?: string } = {}) {
  return invoke<AppLogRecord[]>("list_app_logs", filters);
}

export function clearAppLogs() {
  return invoke<void>("clear_app_logs");
}
