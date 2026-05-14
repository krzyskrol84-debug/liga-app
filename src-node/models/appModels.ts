import type { ChampionRole } from "./domain.js";

export type PatchInfo = {
  patch: string;
  language: string;
  fetchedAt: string;
  isCurrent: boolean;
};

export type Champion = {
  championId: number;
  key: string;
  name: string;
  title?: string;
  roles: ChampionRole[];
  patch: string;
};

export type Rune = {
  id: number;
  key: string;
  name: string;
  styleId: number;
  styleName: string;
  icon?: string;
};

export type RuneStyle = {
  id: number;
  key: string;
  name: string;
  icon?: string;
};

export type SummonerSpell = {
  id: number;
  key: string;
  name: string;
  description?: string;
  icon?: string;
};

export type SelectedBuildMap = Record<string, string>;

export type BuildRecommendation = {
  buildId: string | null;
  label?: string | null;
  championId: number;
  championName: string;
  role: ChampionRole;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
  summonerSpellIds: [number, number];
  winRate: number;
  pickRate: number;
  gamesCount: number;
  patch: string;
  source: "local-json" | "sqlite" | "riot-api";
};

export type ChampionSelectState = {
  active: boolean;
  championId: number | null;
  assignedPosition: ChampionRole | null;
  summonerId: number | null;
  pickActionId: number | null;
  banActionId: number | null;
};

export type AutoPickSettings = {
  enabled: boolean;
  preferredPickChampionId: number | null;
  backupPickChampionIds: number[];
  confirmPick: boolean;
};

export type AutoBanSettings = {
  enabled: boolean;
  preferredBanChampionId: number | null;
  backupBanChampionId: number | null;
  confirmBeforeBan: boolean;
};

export type AutoAcceptSettings = {
  enabled: boolean;
  cooldownMs: number;
  showRiskWarning: boolean;
};

export type AppSettings = {
  onboardingCompleted: boolean;
  autoRunes: boolean;
  autoSummoners: boolean;
  preferredRole: ChampionRole;
  selectedBuilds: SelectedBuildMap;
  language: string;
  notifications: boolean;
  autoPick: AutoPickSettings;
  autoBan: AutoBanSettings;
  autoAccept: AutoAcceptSettings;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  onboardingCompleted: false,
  autoRunes: false,
  autoSummoners: false,
  preferredRole: "middle",
  selectedBuilds: {},
  language: "en_US",
  notifications: true,
  autoPick: {
    enabled: false,
    preferredPickChampionId: null,
    backupPickChampionIds: [],
    confirmPick: true,
  },
  autoBan: {
    enabled: false,
    preferredBanChampionId: null,
    backupBanChampionId: null,
    confirmBeforeBan: true,
  },
  autoAccept: {
    enabled: false,
    cooldownMs: 10_000,
    showRiskWarning: true,
  },
};

export function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.onboardingCompleted === "boolean" &&
    typeof candidate.autoRunes === "boolean" &&
    typeof candidate.autoSummoners === "boolean" &&
    typeof candidate.preferredRole === "string" &&
    ["top", "jungle", "middle", "bottom", "utility"].includes(candidate.preferredRole) &&
    (candidate.selectedBuilds === undefined || isSelectedBuildMap(candidate.selectedBuilds)) &&
    typeof candidate.language === "string" &&
    typeof candidate.notifications === "boolean" &&
    isAutoPickSettings(candidate.autoPick) &&
    isAutoBanSettings(candidate.autoBan) &&
    isAutoAcceptSettings(candidate.autoAccept)
  );
}

export function normalizeAppSettings(value: AppSettings): AppSettings {
  const legacyAutoPick = (value as unknown as { autoPick?: Record<string, unknown> }).autoPick;
  return {
    ...DEFAULT_APP_SETTINGS,
    ...value,
    autoPick: {
      ...DEFAULT_APP_SETTINGS.autoPick,
      ...value.autoPick,
      preferredPickChampionId:
        typeof legacyAutoPick?.preferredPickChampionId === "number"
          ? legacyAutoPick.preferredPickChampionId
          : typeof legacyAutoPick?.preferredChampionId === "number"
            ? legacyAutoPick.preferredChampionId
            : DEFAULT_APP_SETTINGS.autoPick.preferredPickChampionId,
      backupPickChampionIds:
        Array.isArray(legacyAutoPick?.backupPickChampionIds)
          ? legacyAutoPick.backupPickChampionIds.filter(Number.isInteger)
          : Array.isArray(legacyAutoPick?.backupChampionIds)
            ? legacyAutoPick.backupChampionIds.filter(Number.isInteger)
            : DEFAULT_APP_SETTINGS.autoPick.backupPickChampionIds,
      confirmPick:
        typeof legacyAutoPick?.confirmPick === "boolean"
          ? legacyAutoPick.confirmPick
          : typeof legacyAutoPick?.confirmBeforePick === "boolean"
            ? legacyAutoPick.confirmBeforePick
            : DEFAULT_APP_SETTINGS.autoPick.confirmPick,
    },
    selectedBuilds: isSelectedBuildMap(value.selectedBuilds) ? value.selectedBuilds : {},
  };
}

export function buildSelectionKey(championId: number, role: ChampionRole): string {
  return `${championId}:${role}`;
}

function isAutoPickSettings(value: unknown): value is AutoPickSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const preferredPickChampionId =
    candidate.preferredPickChampionId ?? candidate.preferredChampionId ?? null;
  const backupPickChampionIds =
    candidate.backupPickChampionIds ?? candidate.backupChampionIds ?? [];
  const confirmPick = candidate.confirmPick ?? candidate.confirmBeforePick;
  return (
    typeof candidate.enabled === "boolean" &&
    (preferredPickChampionId === null || Number.isInteger(preferredPickChampionId)) &&
    Array.isArray(backupPickChampionIds) &&
    backupPickChampionIds.every(Number.isInteger) &&
    typeof confirmPick === "boolean"
  );
}

function isAutoBanSettings(value: unknown): value is AutoBanSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.enabled === "boolean" &&
    (candidate.preferredBanChampionId === null || Number.isInteger(candidate.preferredBanChampionId)) &&
    (candidate.backupBanChampionId === null || Number.isInteger(candidate.backupBanChampionId)) &&
    typeof candidate.confirmBeforeBan === "boolean"
  );
}

function isAutoAcceptSettings(value: unknown): value is AutoAcceptSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.enabled === "boolean" &&
    Number.isInteger(candidate.cooldownMs) &&
    typeof candidate.showRiskWarning === "boolean"
  );
}

function isSelectedBuildMap(value: unknown): value is SelectedBuildMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, candidate]) => typeof key === "string" && key.length > 0 && typeof candidate === "string" && candidate.length > 0,
  );
}
