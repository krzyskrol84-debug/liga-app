import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  AlertCircle,
  Bell,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Flame,
  Gamepad2,
  Gauge,
  Hash,
  Loader2,
  MonitorUp,
  PlugZap,
  Radio,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import itemAnalyticsData from "../../data/itemAnalytics.json";
import matchupAnalyticsData from "../../data/matchupAnalytics.json";
import recommendations from "../../data/recommendations.json";
import {
  DEFAULT_APP_SETTINGS,
  buildSelectionKey,
  isAppSettings,
  normalizeAppSettings,
  type AppSettings,
} from "../../src-node/models/appModels";
import { clearAppLogs, getSetting, listAppLogs, setSetting, writeAppLog, type AppLogRecord } from "../lib/database";
import { buildMatchupAnalytics, type AnalyticsEntry } from "../lib/matchupAnalytics";

type Role = "top" | "jungle" | "middle" | "bottom" | "utility";
type ApplyStatus = "idle" | "checking" | "applying" | "success" | "error";
type AppView = "assistant" | "settings" | "diagnostics";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type LoadStatus = "idle" | "loading" | "ready" | "error";
type BackendConnectionState = "checking" | "online" | "offline";
type BackendAdminAction = "seed" | "update" | "analyze" | "full-refresh" | null;

type Recommendation = {
  buildId?: string;
  label?: string;
  championId?: number;
  champion: string;
  role: Role;
  fallback?: boolean;
  primaryStyle: string;
  subStyle: string;
  selectedPerkIds: number[];
  summonerSpellIds: [number, number];
  winRate: number;
  pickRate: number;
  gamesCount: number;
  patch: string;
  source?: "riot-api" | "local-json";
};

type LeagueClientStatus = {
  connected: boolean;
  gameflowPhase: string | null;
  lockfilePath: string | null;
  error: string | null;
};

type AutoActionResponse = {
  success: boolean;
  action: string;
  gameflowPhase: string;
  actionId: number | null;
  championId: number | null;
  localPlayerCellId: number | null;
  statusCode: number | null;
  body: string | null;
  reason: string | null;
};

type ApplyRecommendationResponse = {
  success: boolean;
  champion: string;
  role: string;
  gameflowPhase: string;
  runePageId: number;
  runePageName: string;
  spell1Id: number;
  spell2Id: number;
  summonerId: number;
};

type RiotStaticData = {
  patch: string;
  language: string;
  status: DataDragonStatus;
  champions: ChampionStaticData[];
  championNameToId: Record<string, number>;
  runes: Record<string, RuneStaticData>;
  perkStyles: PerkStyleStaticData[];
  summonerSpells: Record<string, SummonerSpellStaticData>;
  items: Record<string, ItemStaticData>;
  warnings: string[];
};

type DataDragonStatus = {
  state: string;
  patch: string | null;
  patchSource: string;
  cachePath: string | null;
  message: string | null;
};

type ChampionStaticData = {
  id: string;
  key: number;
  name: string;
  title: string;
  iconUrl: string;
};

type RuneStaticData = {
  id: number;
  key: string;
  name: string;
  iconUrl: string | null;
  styleId: number | null;
  styleName: string | null;
};

type PerkStyleStaticData = {
  id: number;
  key: string;
  name: string;
  iconUrl: string;
};

type SummonerSpellStaticData = {
  id: number;
  dataDragonId: string;
  name: string;
  description: string;
  iconUrl: string;
};

type ItemStaticData = {
  id: number;
  name: string;
  description: string;
  plaintext: string;
  iconUrl: string;
};

type MappedRune = {
  id: number;
  name: string;
  iconUrl: string | null;
  styleName: string | null;
  exists: boolean;
};

type MappedSummonerSpell = {
  id: number;
  name: string;
  iconUrl: string | null;
  description: string | null;
  exists: boolean;
};

type RiotApiStatus = {
  state: "missing" | "available" | "error" | string;
  message: string;
  statusCode: number | null;
};

type OverlayPayload = {
  recommendation: Recommendation;
  clientStatus: LeagueClientStatus;
  dataDragonPatch: string | null;
  patchSource: string | null;
  buildItems: string[];
};

type ItemAnalyticsEntry = {
  champion: string;
  role: Role;
  items?: Array<{
    name: string;
    description?: string;
  }>;
  coreItems?: Array<{
    name: string;
    description?: string;
  }>;
  fourthItemOptions?: Array<{
    name: string;
    description?: string;
    winRate?: number;
    matches?: number;
  }>;
  fifthItemOptions?: Array<{
    name: string;
    description?: string;
    winRate?: number;
    matches?: number;
  }>;
  sixthItemOptions?: Array<{
    name: string;
    description?: string;
    winRate?: number;
    matches?: number;
  }>;
};

type MatchupAnalyticsEntry = {
  champion: string;
  role: Role;
  toughestMatchups: AnalyticsEntry[];
  bestPicks: AnalyticsEntry[];
  worstPicks: AnalyticsEntry[];
};

type BackendStatus = {
  state: BackendConnectionState;
  url: string;
  healthUrl: string;
  message: string;
  lastHealthResponse: string;
  lastHealthError: string | null;
};

type BackendRecommendationDto = {
  championId: number;
  role: Role;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
  summonerSpellIds: number[];
  itemRecommendations: Array<{
    itemSetType: string;
    itemIds: number[];
    gamesCount: number;
    wins: number;
    winRate: number;
  }>;
  winRate: number;
  gamesCount: number;
  wins: number;
  patch: string;
  source: "riot-api";
};

type BackendItemOptionDto = {
  itemIds: number[];
  gamesCount: number;
  wins: number;
  winRate: number;
  pickRate: number;
  patch: string;
};

type BackendItemsResponse = {
  startingItems: BackendItemOptionDto[];
  coreItems: BackendItemOptionDto[];
  fourthItemOptions: BackendItemOptionDto[];
  fifthItemOptions: BackendItemOptionDto[];
  sixthItemOptions: BackendItemOptionDto[];
};

type BackendMatchupEntryDto = {
  opponentChampionId: number;
  gamesCount: number;
  wins: number;
  winRate: number;
  difficulty: string;
  patch: string;
};

type BackendMatchupsResponse = {
  toughestMatchups: BackendMatchupEntryDto[];
  bestMatchups: BackendMatchupEntryDto[];
};

type BackendDiagnosticsResponse = {
  ok: true;
  backendOnline: boolean;
  riotApiAvailable?: boolean;
  latestPatch: {
    patch: string;
    source: string;
    cached: boolean;
  } | null;
  trackedAccountsCount: number;
  matchRecordsCount: number;
  recommendationStatsCount: number;
  itemStatsCount: number;
  matchupStatsCount: number;
  lastFullRefresh: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    metadata: unknown;
  } | null;
  lastErrors: Array<{
    jobName: string;
    target: string | null;
    startedAt: string;
    errorMessage: string | null;
  }>;
  rateLimitStatus: {
    active: boolean;
    statusCode?: number | null;
    retryAfterMs?: number | null;
    lastRetryAt: string;
  } | null;
};

type BackendJobStatusResponse = {
  running: boolean;
  currentJob: string | null;
  progress: number;
  processedMatches: number;
  recommendationStatsAdded: number;
  itemStatsAdded: number;
  matchupStatsAdded: number;
  currentChampion: string | null;
  currentRole: string | null;
  estimatedRemainingMinutes: number | null;
};

type BackendHealthResponse = {
  ok: boolean;
  service: string;
  database?: {
    ok: boolean;
    error?: string;
  };
};

type BackendRiotApiStatusResponse = {
  ok: boolean;
  available: boolean;
  state: "available" | "missing" | "error" | string;
  message: string;
};

type BackendVersionResponse = {
  version: string;
  buildTime: string;
  statsUpdatedAt: string | null;
};

const roleLabels: Record<Role, string> = {
  top: "Top",
  jungle: "Jungle",
  middle: "Mid",
  bottom: "ADC",
  utility: "Support",
};

const data = recommendations as Recommendation[];
const itemAnalyticsEntries = itemAnalyticsData as ItemAnalyticsEntry[];
const matchupAnalyticsEntries = matchupAnalyticsData as MatchupAnalyticsEntry[];
const overlayStorageKey = "liga.overlay.payload";
const recommendationIndex = buildRecommendationIndex(data);
const itemAnalyticsIndex = buildItemAnalyticsIndex(itemAnalyticsEntries);
const matchupAnalyticsIndex = buildMatchupAnalyticsIndex(matchupAnalyticsEntries);
const fallbackChampionsList = [...recommendationIndex.byChampion.keys()].sort();
const allRoles = Object.keys(roleLabels) as Role[];
const recommendationOptionsCache = buildRecommendationOptionsCache(recommendationIndex);
const backendUrl = resolveFrontendBackendUrl();
const defaultSeedRankedAccountsPayload = {
  platformRegion: "eun1",
  routingRegion: "europe",
  queue: "RANKED_SOLO_5x5",
  tiers: ["CHALLENGER", "GRANDMASTER", "MASTER"],
  limit: 1000,
} as const;
const defaultUpdateStatsPayload = {
  count: 80,
} as const;
const defaultFullRefreshPayload = {
  ...defaultSeedRankedAccountsPayload,
  count: 80,
} as const;
const emptyBackendItems: BackendItemsResponse = {
  startingItems: [],
  coreItems: [],
  fourthItemOptions: [],
  fifthItemOptions: [],
  sixthItemOptions: [],
};
const emptyBackendMatchups: BackendMatchupsResponse = {
  toughestMatchups: [],
  bestMatchups: [],
};
const emptyBackendJobStatus: BackendJobStatusResponse = {
  running: false,
  currentJob: null,
  progress: 0,
  processedMatches: 0,
  recommendationStatsAdded: 0,
  itemStatsAdded: 0,
  matchupStatsAdded: 0,
  currentChampion: null,
  currentRole: null,
  estimatedRemainingMinutes: null,
};

const emptyClientStatus: LeagueClientStatus = {
  connected: false,
  gameflowPhase: null,
  lockfilePath: null,
  error: null,
};

export function App() {
  const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
  const [staticData, setStaticData] = useState<RiotStaticData | null>(null);
  const [dataStatus, setDataStatus] = useState<LoadStatus>("idle");
  const [dataError, setDataError] = useState<string | null>(null);
  const [riotApiStatus, setRiotApiStatus] = useState<RiotApiStatus>({
    state: "missing",
    message: "Riot API status has not been checked.",
    statusCode: null,
  });
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    state: backendUrl ? "checking" : "offline",
    url: backendUrl,
    healthUrl: backendUrl ? `${backendUrl}/health` : "",
    message: backendUrl ? "Checking backend connection..." : "Backend URL is not configured.",
    lastHealthResponse: "Not checked yet.",
    lastHealthError: null,
  });
  const [clientStatus, setClientStatus] = useState<LeagueClientStatus>(emptyClientStatus);
  const [champion, setChampion] = useState(fallbackChampionsList[0] ?? "Ahri");
  const [role, setRole] = useState<Role>("middle");
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>("idle");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyRecommendationResponse | null>(null);
  const [view, setView] = useState<AppView>("assistant");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<SaveStatus>("idle");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AppLogRecord[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [backendRecommendations, setBackendRecommendations] = useState<Recommendation[] | null>(null);
  const [backendItemAnalytics, setBackendItemAnalytics] = useState<BackendItemsResponse | null>(null);
  const [backendMatchups, setBackendMatchups] = useState<BackendMatchupsResponse | null>(null);
  const [backendDiagnostics, setBackendDiagnostics] = useState<BackendDiagnosticsResponse | null>(null);
  const [backendJobStatus, setBackendJobStatus] = useState<BackendJobStatusResponse>(emptyBackendJobStatus);
  const [backendVersion, setBackendVersion] = useState<BackendVersionResponse | null>(null);
  const [backendAdminAction, setBackendAdminAction] = useState<BackendAdminAction>(null);
  const [backendAdminError, setBackendAdminError] = useState<string | null>(null);
  const [backendDataLoading, setBackendDataLoading] = useState(false);
  const loggedWarningsRef = useRef<Set<string>>(new Set());
  const previousChampionRef = useRef(champion);
  const previousRoleRef = useRef(role);
  const autoActionTimerRef = useRef<number | null>(null);
  const executedBanActionIdsRef = useRef<Set<number>>(new Set());
  const executedPickActionIdsRef = useRef<Set<number>>(new Set());
  const lastPhaseRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const lastAutoActionLogKeyRef = useRef<string | null>(null);
  const backendRecommendationsCacheRef = useRef<Map<string, Recommendation[]>>(new Map());
  const backendItemAnalyticsCacheRef = useRef<Map<string, BackendItemsResponse>>(new Map());
  const backendMatchupsCacheRef = useRef<Map<string, BackendMatchupsResponse>>(new Map());
  const backendRequestKeyRef = useRef<string | null>(null);
  const backendStatsUpdatedAtRef = useRef<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const champions = useMemo(
    () => [...(staticData?.champions ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [staticData?.champions],
  );
  const debouncedChampion = useDebouncedValue(champion, 120);
  const debouncedRole = useDebouncedValue(role, 120);
  const localBuildOptions = useMemo(
    () => resolveRecommendationOptions(debouncedChampion, debouncedRole),
    [debouncedChampion, debouncedRole],
  );
  const buildOptions = useMemo(
    () => (backendRecommendations && backendRecommendations.length > 0 ? backendRecommendations : localBuildOptions),
    [backendRecommendations, localBuildOptions],
  );
  const buildOptionIds = useMemo(
    () => new Set(buildOptions.map((item) => getRecommendationId(item))),
    [buildOptions],
  );
  const recommendation = useMemo(
    () =>
      buildOptions.find((item) => getRecommendationId(item) === selectedRecommendationId) ??
      (!selectedRecommendationId ? buildOptions[0] ?? null : null),
    [buildOptions, selectedRecommendationId],
  );
  const selectedChampion = useMemo(
    () =>
      champions.find((item) => item.name === champion) ??
      (champion
        ? { id: champion, key: 0, name: champion, title: "", iconUrl: "" }
        : champions[0] ?? null),
    [champion, champions],
  );
  const availableRoles = useMemo(
    () => recommendationIndex.rolesByChampion.get(champion) ?? [],
    [champion],
  );
  const warnings = useMemo(
    () => validateRecommendation(recommendation, champion, staticData),
    [champion, recommendation, staticData],
  );
  const mappedRunes = useMemo(
    () => mapPerkIdsToRunesCached(staticData?.runes ?? null, recommendation?.selectedPerkIds ?? []),
    [recommendation?.selectedPerkIds, staticData?.runes],
  );
  const mappedSummonerSpells = useMemo(
    () => mapSpellIdsToSummonerSpellsCached(staticData?.summonerSpells ?? null, recommendation?.summonerSpellIds ?? []),
    [recommendation?.summonerSpellIds, staticData?.summonerSpells],
  );
  const itemAnalytics = useMemo(
    () => buildItemAnalytics(recommendation, staticData?.items ?? null, backendItemAnalytics),
    [backendItemAnalytics, recommendation, staticData?.items],
  );
  const matchupAnalytics = useMemo(
    () => resolveMatchupAnalytics(data, champion, role, backendMatchups, staticData),
    [backendMatchups, champion, role, staticData],
  );
  const runeGroups = useMemo(
    () =>
      recommendation
        ? {
            primary: mappedRunes.slice(0, 4),
            secondary: mappedRunes.slice(4, 6),
            shards: mappedRunes.slice(6),
          }
        : { primary: [], secondary: [], shards: [] },
    [mappedRunes, recommendation],
  );
  const diagnosticsSummary = useMemo(
    () =>
      buildDiagnosticsSummary(
        logs,
        clientStatus.gameflowPhase,
        staticData?.status ?? null,
        buildOptions.length,
        champions.length,
        backendStatus,
      ),
    [backendStatus, buildOptions.length, champions.length, clientStatus.gameflowPhase, logs, staticData?.status],
  );
  const showOnboarding = settingsLoaded && !isOverlay && !settings.onboardingCompleted;
  const recommendationSource = recommendation?.source ?? "local-json";
  const lastBackendRefreshAt = backendDiagnostics?.lastFullRefresh?.finishedAt ?? null;
  const sampleSizeWarning =
    recommendation && recommendation.gamesCount > 0 && recommendation.gamesCount < 20
      ? "Low sample size. Treat this build as directional only."
      : recommendation && recommendation.gamesCount >= 20 && recommendation.gamesCount < 100
        ? "Small sample size. Confidence is still limited."
        : null;

  useEffect(() => {
    if (isOverlay) return;
    void loadStaticData(false);
    void refreshRiotApiStatus();
    void refreshBackendStatus();
    void refreshBackendJobStatus();
    void refreshBackendVersion();
    void refreshClientStatus();
    void loadSettings();
    void refreshLogs();
    void startAutoActionLoop();

    return () => {
      if (autoActionTimerRef.current !== null) {
        window.clearTimeout(autoActionTimerRef.current);
      }
    };
  }, [isOverlay]);

  useEffect(() => {
    if (isOverlay || !backendUrl || (view !== "diagnostics" && !backendAdminAction && !backendJobStatus.running)) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshBackendJobStatus();
    }, backendJobStatus.running || backendAdminAction ? 2_000 : 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [backendAdminAction, backendJobStatus.running, isOverlay, view]);

  useEffect(() => {
    if (staticData?.champions.length && !staticData.champions.some((item) => item.name === champion)) {
      setChampion(staticData.champions[0].name);
    }
  }, [champion, staticData]);

  useEffect(() => {
    setRole(settings.preferredRole);
  }, [settings.preferredRole]);

  useEffect(() => {
    const championId = recommendation?.championId ?? selectedChampion?.key ?? null;
    if (!championId || !selectedRecommendationId) return;

    const key = buildSelectionKey(championId, role);
    if (settings.selectedBuilds[key] === selectedRecommendationId) return;

    const nextSettings = {
      ...settings,
      selectedBuilds: {
        ...settings.selectedBuilds,
        [key]: selectedRecommendationId,
      },
    };

    setSettings(nextSettings);
    void persistBuildSelection(nextSettings);
  }, [recommendation?.championId, role, selectedChampion?.key, selectedRecommendationId, settings]);

  useEffect(() => {
    if (buildOptions.length === 0) {
      if (selectedRecommendationId !== null) {
        setSelectedRecommendationId(null);
      }
      previousChampionRef.current = champion;
      previousRoleRef.current = role;
      return;
    }

    const championChanged = previousChampionRef.current !== champion;
    const roleChanged = previousRoleRef.current !== role;
    const championId = buildOptions[0]?.championId ?? selectedChampion?.key ?? null;
    const savedRecommendationId = championId ? settings.selectedBuilds[buildSelectionKey(championId, role)] : null;
    const selectedStillExists = selectedRecommendationId !== null && buildOptionIds.has(selectedRecommendationId);

    let nextSelectedRecommendationId = selectedRecommendationId;

    if (!selectedRecommendationId || championChanged || roleChanged || !selectedStillExists) {
      nextSelectedRecommendationId = savedRecommendationId && buildOptionIds.has(savedRecommendationId)
        ? savedRecommendationId
        : getRecommendationId(buildOptions[0]);
    }

    if (nextSelectedRecommendationId !== selectedRecommendationId) {
      setSelectedRecommendationId(nextSelectedRecommendationId);
    }

    previousChampionRef.current = champion;
    previousRoleRef.current = role;
  }, [buildOptionIds, buildOptions, champion, role, selectedChampion?.key, selectedRecommendationId, settings.selectedBuilds]);

  useEffect(() => {
    if (view !== "diagnostics" || warnings.length === 0) return;

    void Promise.all(
      warnings
        .filter((warning) => {
          const key = `${champion}:${role}:${recommendation ? getRecommendationId(recommendation) : "none"}:${warning}`;
          if (loggedWarningsRef.current.has(key)) return false;
          loggedWarningsRef.current.add(key);
          return true;
        })
        .map((warning) =>
          logAppEvent("warn", "recommendation_validation", warning, {
            champion,
            role,
            buildId: recommendation ? getRecommendationId(recommendation) : null,
          }),
        ),
    );
  }, [champion, recommendation, role, view, warnings]);

  if (isOverlay) {
    return <OverlayApp staticData={staticData} />;
  }

  const loadStaticData = useCallback(async (forceRefresh: boolean) => {
    setDataStatus("loading");
    setDataError(null);

    try {
      const command = forceRefresh ? "refresh_riot_static_data" : "get_riot_static_data";
      const nextData = await invoke<RiotStaticData>(command);
      setStaticData(nextData);
      setDataStatus("ready");
      const firstChampion = nextData.champions[0]?.name;
      if (firstChampion && !nextData.champions.some((item) => item.name === champion)) {
        setChampion(firstChampion);
      }
      await logAppEvent("info", "data_dragon", `Data Dragon patch ${nextData.patch} loaded`, {
        patch: nextData.patch,
        state: nextData.status.state,
        patchSource: nextData.status.patchSource,
      });
    } catch (error) {
      setDataStatus("error");
      setDataError(formatError(error));
    }
  }, [champion]);

  const clearRiotCache = useCallback(async () => {
    setDataStatus("loading");
    setDataError(null);

    try {
      const nextData = await invoke<RiotStaticData>("clear_riot_data_cache");
      setStaticData(nextData);
      setDataStatus("ready");
      await logAppEvent("info", "data_dragon", `Riot/Data Dragon cache cleared and patch ${nextData.patch} loaded`, {
        patch: nextData.patch,
        patchSource: nextData.status.patchSource,
      });
    } catch (error) {
      setDataStatus("error");
      setDataError(formatError(error));
    }
  }, []);

  const refreshRiotApiStatus = useCallback(async () => {
    if (backendUrl) {
      try {
        const backendRiotStatus = await fetchBackendJson<BackendRiotApiStatusResponse>("/api/riot/status", {
          timeoutMs: 4_000,
          retries: 1,
        });
        const nextStatus: RiotApiStatus = {
          state: backendRiotStatus.available ? "available" : "missing",
          message: backendRiotStatus.message,
          statusCode: null,
        };
        setRiotApiStatus((current) => (isSameRiotApiStatus(current, nextStatus) ? current : nextStatus));
        return;
      } catch (error) {
        const nextStatus: RiotApiStatus = {
          state: "error",
          message: `Backend Riot API status unavailable: ${formatError(error)}`,
          statusCode: null,
        };
        setRiotApiStatus((current) => (isSameRiotApiStatus(current, nextStatus) ? current : nextStatus));
        return;
      }
    }

    try {
      const nextStatus = await invoke<RiotApiStatus>("get_riot_api_status");
      setRiotApiStatus((current) => (isSameRiotApiStatus(current, nextStatus) ? current : nextStatus));
    } catch (error) {
      const nextStatus = { state: "error", message: formatError(error), statusCode: null };
      setRiotApiStatus((current) => (isSameRiotApiStatus(current, nextStatus) ? current : nextStatus));
    }
  }, []);

  const clearBackendDataCache = useCallback(() => {
    backendRecommendationsCacheRef.current.clear();
    backendItemAnalyticsCacheRef.current.clear();
    backendMatchupsCacheRef.current.clear();
    setBackendRecommendations(null);
    setBackendItemAnalytics(null);
    setBackendMatchups(null);
  }, []);

  const refreshBackendVersion = useCallback(async () => {
    if (!backendUrl) {
      setBackendVersion(null);
      backendStatsUpdatedAtRef.current = null;
      return null;
    }

    try {
      const nextVersion = await fetchBackendJson<BackendVersionResponse>("/api/version", {
        timeoutMs: 4_000,
        retries: 1,
      });

      if (
        backendStatsUpdatedAtRef.current !== null &&
        nextVersion.statsUpdatedAt !== backendStatsUpdatedAtRef.current
      ) {
        clearBackendDataCache();
      }

      backendStatsUpdatedAtRef.current = nextVersion.statsUpdatedAt;
      setBackendVersion(nextVersion);
      return nextVersion;
    } catch {
      return null;
    }
  }, [clearBackendDataCache]);

  const refreshBackendStatus = useCallback(async () => {
    if (!backendUrl) {
      const nextStatus: BackendStatus = {
        state: "offline",
        url: "",
        healthUrl: "",
        message: "Backend URL is not configured.",
        lastHealthResponse: "Not checked yet.",
        lastHealthError: null,
      };
      setBackendStatus((current) => (isSameBackendStatus(current, nextStatus) ? current : nextStatus));
      return nextStatus;
    }

    setBackendStatus((current) =>
      current.state === "online"
        ? current
        : {
            ...current,
            state: "checking",
            message: "Checking backend connection...",
          },
    );

    try {
      const health = await fetchBackendJson<BackendHealthResponse>("/health", {
        timeoutMs: 4_000,
        retries: 2,
      });
      let diagnostics: BackendDiagnosticsResponse | null = null;

      try {
        diagnostics = await fetchBackendJson<BackendDiagnosticsResponse>("/api/diagnostics", {
          timeoutMs: 6_000,
          retries: 1,
        });
        setBackendDiagnostics(diagnostics);
      } catch {
        setBackendDiagnostics(null);
      }

      const backendOnline = health.ok === true;
      const riotApiAvailable = diagnostics?.riotApiAvailable ?? null;
      const nextStatus: BackendStatus = {
        state: backendOnline ? "online" : "offline",
        url: backendUrl,
        healthUrl: `${backendUrl}/health`,
        message: backendOnline
          ? `Backend online${diagnostics?.latestPatch?.patch ? ` | Patch ${diagnostics.latestPatch.patch}` : ""}${
              riotApiAvailable === null ? "" : riotApiAvailable ? " | Riot API available" : " | Riot API missing"
            }`
          : "Backend health check failed.",
        lastHealthResponse: JSON.stringify(health),
        lastHealthError: null,
      };
      setBackendStatus((current) => (isSameBackendStatus(current, nextStatus) ? current : nextStatus));
      return nextStatus;
    } catch (error) {
      setBackendDiagnostics(null);
      const message = formatError(error);
      const nextStatus: BackendStatus = {
        state: "offline",
        url: backendUrl,
        healthUrl: `${backendUrl}/health`,
        message,
        lastHealthResponse: "Unavailable",
        lastHealthError: message,
      };
      setBackendStatus((current) => (isSameBackendStatus(current, nextStatus) ? current : nextStatus));
      return nextStatus;
    }
  }, []);

  const refreshBackendJobStatus = useCallback(async () => {
    if (!backendUrl) {
      setBackendJobStatus(emptyBackendJobStatus);
      return emptyBackendJobStatus;
    }

    try {
      const nextStatus = await fetchBackendJson<BackendJobStatusResponse>("/api/jobs/status", {
        timeoutMs: 4_000,
        retries: 1,
      });
      setBackendJobStatus(nextStatus);
      return nextStatus;
    } catch {
      setBackendJobStatus((current) => ({
        ...current,
        running: false,
      }));
      return null;
    }
  }, []);

  const loadBackendData = useCallback(
    async (championId: number, championName: string, selectedRole: Role) => {
      const cacheKey = `${championId}:${selectedRole}`;
      const backendRole = mapFrontendRoleToBackendRole(selectedRole);
      backendRequestKeyRef.current = cacheKey;
      setBackendDataLoading(true);

      if (!backendUrl) {
        setBackendRecommendations(null);
        setBackendItemAnalytics(null);
        setBackendMatchups(null);
        setBackendDataLoading(false);
        return;
      }

      const cachedRecommendations = backendRecommendationsCacheRef.current.get(cacheKey) ?? null;
      const cachedItems = backendItemAnalyticsCacheRef.current.get(cacheKey) ?? null;
      const cachedMatchups = backendMatchupsCacheRef.current.get(cacheKey) ?? null;

      if (cachedRecommendations || cachedItems || cachedMatchups) {
        setBackendRecommendations(cachedRecommendations);
        setBackendItemAnalytics(cachedItems);
        setBackendMatchups(cachedMatchups);
      }

      try {
        const [recommendationResponse, itemsResponse, matchupsResponse] = await Promise.all([
          fetchBackendJson<BackendRecommendationDto[]>(
            `/api/recommendations?championId=${championId}&role=${backendRole}`,
          ),
          fetchBackendJson<BackendItemsResponse>(`/api/items?championId=${championId}&role=${backendRole}`),
          fetchBackendJson<BackendMatchupsResponse>(
            `/api/matchups?championId=${championId}&role=${backendRole}`,
          ),
        ]);

        const mergedRecommendations = mergeBackendRecommendations(
          championId,
          championName,
          selectedRole,
          recommendationResponse,
          localBuildOptions,
          staticData,
        );
        const nextRecommendations =
          mergedRecommendations.length > 0 ? mergedRecommendations : null;
        const nextItems = hasBackendItems(itemsResponse) ? itemsResponse : null;
        const nextMatchups = hasBackendMatchups(matchupsResponse) ? matchupsResponse : null;

        if (backendRequestKeyRef.current !== cacheKey) {
          return;
        }

        if (nextRecommendations) {
          backendRecommendationsCacheRef.current.set(cacheKey, nextRecommendations);
        }
        if (nextItems) {
          backendItemAnalyticsCacheRef.current.set(cacheKey, nextItems);
        }
        if (nextMatchups) {
          backendMatchupsCacheRef.current.set(cacheKey, nextMatchups);
        }

        setBackendRecommendations(nextRecommendations);
        setBackendItemAnalytics(nextItems);
        setBackendMatchups(nextMatchups);
        setBackendStatus((current) => {
        const nextStatus: BackendStatus = {
          state: "online",
          url: backendUrl,
          healthUrl: `${backendUrl}/health`,
          message: "Backend online",
          lastHealthResponse: current.lastHealthResponse,
          lastHealthError: current.lastHealthError,
        };
          return isSameBackendStatus(current, nextStatus) ? current : nextStatus;
        });
      } catch (error) {
        const message = formatError(error);
        if (backendRequestKeyRef.current !== cacheKey) {
          return;
        }
        setBackendRecommendations(null);
        setBackendItemAnalytics(null);
        setBackendMatchups(null);
        setBackendStatus((current) => {
          const nextStatus: BackendStatus = {
            state: current.state === "online" ? "online" : "checking",
            url: backendUrl,
            healthUrl: `${backendUrl}/health`,
            message: current.state === "online" ? `Backend online; data request failed: ${message}` : message,
            lastHealthResponse: current.lastHealthResponse,
            lastHealthError: current.lastHealthError,
          };
          return isSameBackendStatus(current, nextStatus) ? current : nextStatus;
        });
      } finally {
        if (backendRequestKeyRef.current === cacheKey) {
          setBackendDataLoading(false);
        }
      }
    },
    [localBuildOptions, staticData],
  );

  const refreshBackendSnapshot = useCallback(async () => {
    clearBackendDataCache();
    await refreshBackendVersion();
    await refreshBackendStatus();
    const championId = selectedChampion?.key ?? 0;
    if (!championId || !staticData) {
      return;
    }

    await loadBackendData(championId, champion, role);
  }, [champion, clearBackendDataCache, loadBackendData, refreshBackendStatus, refreshBackendVersion, role, selectedChampion?.key, staticData]);

  const testRiotApi = useCallback(async () => {
    try {
      const result = await invoke<RiotApiStatus>("test_riot_api");
      setRiotApiStatus(result);
      await logAppEvent(result.state === "error" ? "warn" : "info", "riot_api", result.message, {
        state: result.state,
        statusCode: result.statusCode,
      });
    } catch (error) {
      const message = formatError(error);
      setRiotApiStatus({ state: "error", message, statusCode: null });
      await logAppEvent("error", "riot_api", message);
    }
  }, [view]);

  const refreshClientStatus = useCallback(async () => {
    try {
      const status = await invoke<LeagueClientStatus>("check_league_client_status");
      setClientStatus((current) => (isSameLeagueClientStatus(current, status) ? current : status));
      return status;
    } catch (error) {
      const status = { ...emptyClientStatus, error: formatError(error) };
      setClientStatus((current) => (isSameLeagueClientStatus(current, status) ? current : status));
      return status;
    }
  }, []);

  const logAppEvent = useCallback(async (level: AppLogRecord["level"], category: string, message: string, context?: unknown) => {
    try {
      await writeAppLog({ level, category, message, context });
      if (view === "diagnostics") await refreshLogs();
    } catch {
      // Diagnostics must not interrupt the assistant flow.
    }
  }, [view]);

  const runBackendAdminJob = useCallback(async (
    action: Exclude<BackendAdminAction, null>,
    path: string,
    body?: unknown,
  ) => {
    if (!backendUrl) {
      setBackendAdminError("Backend URL is not configured.");
      return;
    }

    setBackendAdminAction(action);
    setBackendAdminError(null);

    try {
      await fetchBackendJson(path, {
        method: "POST",
        body,
      });
      await logAppEvent("info", "backend_admin", `Backend admin action '${action}' completed.`, {
        path,
      });
      await refreshBackendJobStatus();
      await refreshBackendSnapshot();
    } catch (error) {
      const message = formatError(error);
      setBackendAdminError(message);
      await logAppEvent("error", "backend_admin", `Backend admin action '${action}' failed.`, {
        path,
        error: message,
      });
      await refreshBackendJobStatus();
      await refreshBackendStatus();
    } finally {
      setBackendAdminAction(null);
    }
  }, [logAppEvent, refreshBackendJobStatus, refreshBackendSnapshot, refreshBackendStatus]);

  const refreshLogs = useCallback(async () => {
    try {
      const nextLogs = await listAppLogs({ limit: 200 });
      setLogs((current) => (areLogsEqual(current, nextLogs) ? current : nextLogs));
      setLogsError((current) => (current === null ? current : null));
    } catch (error) {
      setLogsError(formatError(error));
    }
  }, []);

  const clearLogs = useCallback(async () => {
    try {
      await clearAppLogs();
      await refreshLogs();
    } catch (error) {
      setLogsError(formatError(error));
    }
  }, [refreshLogs]);

  const loadSettings = useCallback(async () => {
    try {
      const stored = await getSetting("app.settings");
      if (stored?.value && isAppSettings(stored.value)) {
        const nextSettings = normalizeAppSettings(stored.value);
        setSettings((current) => (JSON.stringify(current) === JSON.stringify(nextSettings) ? current : nextSettings));
      }
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  const saveSettings = useCallback(async (nextSettings = settings) => {
    setSettingsStatus("saving");
    setSettingsError(null);

    try {
      await setSetting({ key: "app.settings", value: nextSettings, valueType: "json" });
      setSettingsStatus("saved");
    } catch (error) {
      setSettingsStatus("error");
      setSettingsError(formatError(error));
    }
  }, [settings]);

  const persistBuildSelection = useCallback(async (nextSettings: AppSettings) => {
    try {
      await setSetting({ key: "app.settings", value: nextSettings, valueType: "json" });
    } catch (error) {
      setSettingsError(formatError(error));
    }
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setSettingsStatus("idle");
    setSettingsError(null);
  }, []);

  const completeOnboarding = useCallback(async () => {
    const nextSettings: AppSettings = {
      ...settingsRef.current,
      onboardingCompleted: true,
    };
    setSettings(nextSettings);
    setSettingsStatus("idle");
    setSettingsError(null);
    await saveSettings(nextSettings);
  }, [saveSettings]);

  const handleChampionChange = useCallback((nextChampion: string) => {
    setChampion(nextChampion);
    setRole(recommendationIndex.defaultRoleByChampion.get(nextChampion) ?? settings.preferredRole);
    setSelectedRecommendationId(null);
    resetApplyState();
  }, [settings.preferredRole]);

  const resetApplyState = useCallback(() => {
    setApplyStatus("idle");
    setApplyError(null);
    setApplyResult(null);
  }, []);

  const handleRecommendationSelect = useCallback((key: string) => {
    setSelectedRecommendationId(key);
    resetApplyState();
  }, [resetApplyState]);

  const handleApplyToLol = useCallback(async () => {
    if (!recommendation) {
      setApplyStatus("error");
      setApplyError("No local recommendation is available for this champion.");
      return;
    }

    setApplyStatus("checking");
    setApplyError(null);
    setApplyResult(null);

    const status = await refreshClientStatus();
    if (!status.connected) {
      setApplyStatus("error");
      setApplyError(status.error ?? "League Client is not connected.");
      return;
    }

    if (status.gameflowPhase !== "ChampSelect") {
      setApplyStatus("error");
      setApplyError(`Champion select is not active. Current phase: ${status.gameflowPhase ?? "unknown"}.`);
      return;
    }

    setApplyStatus("applying");

    try {
      const result = await invoke<ApplyRecommendationResponse>("apply_recommendation_to_lol", {
        request: {
          champion: recommendation.champion,
          role: recommendation.role,
          primaryStyle: recommendation.primaryStyle,
          subStyle: recommendation.subStyle,
          selectedPerkIds: recommendation.selectedPerkIds,
          summonerSpellIds: recommendation.summonerSpellIds,
        },
      });

      setApplyResult(result);
      setApplyStatus("success");
      await logAppEvent("info", "runes_set", `Applied rune page ${result.runePageName}`, result);
      await logAppEvent("info", "summoners_set", `Applied summoner spells ${result.spell1Id}, ${result.spell2Id}`, {
        spell1Id: result.spell1Id,
        spell2Id: result.spell2Id,
        champion: result.champion,
        role: result.role,
      });
      await refreshClientStatus();
    } catch (error) {
      const message = formatError(error);
      setApplyStatus("error");
      setApplyError(message);
      await logAppEvent("error", "api_error", message, { champion: recommendation.champion, role: recommendation.role });
    }
  }, [logAppEvent, recommendation, refreshClientStatus]);

  const openOverlay = useCallback(async () => {
    if (!recommendation) return;

    const payload: OverlayPayload = {
      recommendation,
      clientStatus,
      dataDragonPatch: staticData?.patch ?? null,
      patchSource: staticData?.status.patchSource ?? null,
      buildItems: getBuildItems(recommendation),
    };
    localStorage.setItem(overlayStorageKey, JSON.stringify(payload));

    const existing = await WebviewWindow.getByLabel("liga-overlay");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      await existing.setAlwaysOnTop(true);
      await emit("overlay:update", payload);
      return;
    }

    const overlay = new WebviewWindow("liga-overlay", {
      url: "/?overlay=1",
      title: "Liga Overlay",
      width: 420,
      height: 620,
      minWidth: 360,
      minHeight: 420,
      resizable: true,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focus: false,
      transparent: false,
    });

    overlay.once("tauri://created", () => void emit("overlay:update", payload));
  }, [clientStatus, recommendation, staticData?.patch, staticData?.status.patchSource]);

  const startAutoActionLoop = useCallback(async () => {
    const run = async () => {
      try {
        const status = await refreshClientStatus();
        if (lastPhaseRef.current !== status.gameflowPhase) {
          await logAppEvent("info", "gameflowPhase", `gameflowPhase=${status.gameflowPhase ?? "unknown"}`, {
            gameflowPhase: status.gameflowPhase,
            connected: status.connected,
          });
        }

        if (!status.connected) {
          executedBanActionIdsRef.current.clear();
          executedPickActionIdsRef.current.clear();
          lastPhaseRef.current = status.gameflowPhase;
          scheduleAutoActionLoop(3000);
          return;
        }

        const currentSettings = settingsRef.current;

        if (status.gameflowPhase === "ReadyCheck" && currentSettings.autoAccept.enabled) {
          const result = await invoke<AutoActionResponse>("auto_accept_ready_check");
          await writeAutoActionLog(result);
          scheduleAutoActionLoop(400);
          return;
        }

        if (status.gameflowPhase === "ChampSelect") {
          if (lastPhaseRef.current !== "ChampSelect") {
            executedBanActionIdsRef.current.clear();
            executedPickActionIdsRef.current.clear();
          }

          if (currentSettings.autoBan.enabled) {
            const result = await invoke<AutoActionResponse>("auto_ban_champion", {
              request: {
                preferredBanChampionId: currentSettings.autoBan.preferredBanChampionId,
                backupBanChampionId: currentSettings.autoBan.backupBanChampionId,
              },
            });
            if (result.success && result.actionId !== null) {
              executedBanActionIdsRef.current.add(result.actionId);
            }
            await writeAutoActionLog(result);
          }

          if (currentSettings.autoPick.enabled) {
            const result = await invoke<AutoActionResponse>("auto_pick_champion", {
              request: {
                preferredPickChampionId: currentSettings.autoPick.preferredPickChampionId,
                backupPickChampionIds: currentSettings.autoPick.backupPickChampionIds,
                confirmPick: currentSettings.autoPick.confirmPick,
              },
            });
            if (result.success && result.actionId !== null && result.reason !== "already_executed") {
              executedPickActionIdsRef.current.add(result.actionId);
            }
            await writeAutoActionLog(result);
          }

          lastPhaseRef.current = status.gameflowPhase;
          scheduleAutoActionLoop(2000);
          return;
        }

        if (lastPhaseRef.current === "ChampSelect") {
          executedBanActionIdsRef.current.clear();
          executedPickActionIdsRef.current.clear();
        }
        lastPhaseRef.current = status.gameflowPhase;
      } catch (error) {
        await logAppEvent("error", "auto_action_flow", formatError(error));
      }

      scheduleAutoActionLoop(3000);
    };

    await run();
  }, [logAppEvent, refreshClientStatus]);

  const scheduleAutoActionLoop = useCallback((delayMs: number) => {
    if (autoActionTimerRef.current !== null) {
      window.clearTimeout(autoActionTimerRef.current);
    }
    autoActionTimerRef.current = window.setTimeout(() => {
      void startAutoActionLoop();
    }, delayMs);
  }, [startAutoActionLoop]);

  const writeAutoActionLog = useCallback(async (result: AutoActionResponse) => {
    const logKey = JSON.stringify({
      action: result.action,
      success: result.success,
      gameflowPhase: result.gameflowPhase,
      actionId: result.actionId,
      championId: result.championId,
      reason: result.reason,
      statusCode: result.statusCode,
    });
    if (lastAutoActionLogKeyRef.current === logKey) {
      return;
    }
    lastAutoActionLogKeyRef.current = logKey;
    const level: AppLogRecord["level"] = result.success ? "info" : result.statusCode ? "error" : "warn";
    const message = `${result.action} ${result.success ? "success" : result.reason ?? "skipped"}`;
    await logAppEvent(level, `auto_${result.action}`, message, result);
  }, [logAppEvent]);

  useEffect(() => {
    if (isOverlay) {
      return;
    }

    const championId = selectedChampion?.key ?? 0;
    if (!championId || !staticData) {
      setBackendRecommendations(null);
      setBackendItemAnalytics(null);
      setBackendMatchups(null);
      return;
    }

    void loadBackendData(championId, debouncedChampion, debouncedRole);
  }, [debouncedChampion, debouncedRole, isOverlay, loadBackendData, selectedChampion?.key, staticData]);

  return (
    <main className="min-h-screen bg-[#0a0f1a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col gap-8 px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-slate-800/80 bg-slate-950/80 px-5 py-5 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
                {selectedChampion?.iconUrl ? (
                  <img src={selectedChampion.iconUrl} alt={selectedChampion.name} className="h-full w-full object-cover" />
                ) : (
                  <Gamepad2 className="text-cyan-300" size={26} />
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
                    LoL Stats Dashboard
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                    {roleLabels[role]}
                  </span>
                </div>
                <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">{selectedChampion?.name ?? champion}</h1>
                <p className="mt-1 text-sm text-slate-400">
                  {selectedChampion?.title || "Champion Select Assistant"} {staticData?.patch ? `| Patch ${staticData.patch}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex flex-wrap gap-2">
                <ClientStatusBadge status={clientStatus} />
                <BackendBadge status={backendStatus} />
                <DataDragonBadge status={staticData?.status ?? null} loadStatus={dataStatus} />
                <RiotApiBadge status={riotApiStatus} />
              </div>
              <nav className="inline-flex rounded-xl border border-slate-800 bg-slate-900/90 p-1">
                <ViewButton active={view === "assistant"} icon={<Wand2 size={16} />} onClick={() => setView("assistant")}>
                  Assistant
                </ViewButton>
                <ViewButton active={view === "settings"} icon={<Settings size={16} />} onClick={() => setView("settings")}>
                  Settings
                </ViewButton>
                <ViewButton
                  active={view === "diagnostics"}
                  icon={<ClipboardList size={16} />}
                  onClick={() => {
                    setView("diagnostics");
                    void refreshLogs();
                  }}
                >
                  Diagnostics
                </ViewButton>
              </nav>
            </div>
          </div>
        </header>

        {showOnboarding ? (
          <OnboardingScreen
            onContinue={() => void completeOnboarding()}
            status={settingsStatus}
            error={settingsError}
          />
        ) : view === "settings" ? (
          <SettingsScreen
            settings={settings}
            champions={champions}
            status={settingsStatus}
            error={settingsError}
            onChange={updateSettings}
            onSave={() => void saveSettings()}
          />
        ) : view === "diagnostics" ? (
          <DiagnosticsScreen
            logs={logs}
            error={logsError}
            dataStatus={staticData?.status ?? null}
            riotApiStatus={riotApiStatus}
            backendStatus={backendStatus}
            backendDiagnostics={backendDiagnostics}
            backendJobStatus={backendJobStatus}
            backendVersion={backendVersion}
            recommendationCount={buildOptions.length}
            championCount={champions.length}
            currentGameflowPhase={clientStatus.gameflowPhase}
            diagnosticsSummary={diagnosticsSummary}
            matchupAnalytics={matchupAnalytics}
            onRefresh={() => void refreshLogs()}
            onRefreshData={() => void loadStaticData(true)}
            onClear={() => void clearLogs()}
            onClearRiotCache={() => void clearRiotCache()}
            onTestRiotApi={() => void testRiotApi()}
            backendAdminAction={backendAdminAction}
            backendAdminError={backendAdminError}
            onSeedRankedAccounts={() => void runBackendAdminJob("seed", "/api/jobs/seed-ranked-accounts", defaultSeedRankedAccountsPayload)}
            onUpdateStats={() => void runBackendAdminJob("update", "/api/jobs/update-stats", defaultUpdateStatsPayload)}
            onAnalyzeStats={() => void runBackendAdminJob("analyze", "/api/jobs/analyze-global-stats", {})}
            onFullRefresh={() => void runBackendAdminJob("full-refresh", "/api/jobs/full-refresh", defaultFullRefreshPayload)}
          />
        ) : (
          <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="xl:sticky xl:top-5 xl:self-start">
              <div className="rounded-3xl border border-slate-800/80 bg-slate-950/75 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur">
              <div className="mb-5 flex items-center gap-2">
                <Gamepad2 className="text-cyan-300" size={18} />
                <h2 className="text-base font-semibold text-white">Champion Overview</h2>
              </div>

              <div className="space-y-5">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Champion</span>
                  <div className="relative">
                    <select
                      className="h-12 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900/90 px-4 pr-10 text-sm text-white outline-none transition hover:border-slate-500 focus:border-cyan-300"
                      value={champion}
                      onChange={(event) => handleChampionChange(event.target.value)}
                    >
                      {champions.map((item) => (
                        <option key={`${item.key}-${item.name}`} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Role Tabs</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(roleLabels) as Role[]).map((item) => {
                      const active = role === item;
                      const available = availableRoles.includes(item);
                      return (
                        <button
                          key={item}
                          type="button"
                          className={[
                            "h-11 rounded-2xl border px-3 text-sm font-semibold transition",
                            active
                              ? "border-cyan-300 bg-cyan-300 text-slate-950 shadow-[0_0_0_1px_rgba(103,232,249,0.15)]"
                              : "border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:bg-slate-900",
                            available ? "" : "opacity-50",
                          ].join(" ")}
                          onClick={() => {
                            setRole(item);
                            setSelectedRecommendationId(null);
                            resetApplyState();
                          }}
                        >
                          {roleLabels[item]}
                        </button>
                      );
                    })}
                  </div>
                </label>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <InfoPanel title="Patch" value={staticData?.patch ?? "loading"} />
                <InfoPanel title="Champion ID" value={selectedChampion?.key ? String(selectedChampion.key) : "unknown"} />
              </div>

              <div className="mt-6 grid gap-2.5">
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:bg-slate-900/90 disabled:opacity-60"
                  disabled={dataStatus === "loading"}
                  onClick={() => void loadStaticData(true)}
                >
                  {dataStatus === "loading" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                  Odswiez dane Riot/Data Dragon
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-60"
                  disabled={dataStatus === "loading"}
                  onClick={() => void clearRiotCache()}
                >
                  <Trash2 size={16} />
                  Clear Riot/Data Dragon cache
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:bg-slate-900/90"
                  onClick={() => void openOverlay()}
                >
                  <Radio size={16} />
                  Open overlay
                </button>
              </div>

              {dataError ? <Message tone="rose">{dataError}</Message> : null}
              {warnings.map((warning) => (
                <Message key={warning} tone="amber">
                  {warning}
                </Message>
              ))}
              </div>
            </aside>

            <section className="space-y-5">
              {recommendation ? (
                <>
                  <section className="sticky top-3 z-10 rounded-3xl border border-slate-800/80 bg-slate-950/88 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur">
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,420px)] xl:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
                            Active Build
                          </span>
                          <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                            {roleLabels[recommendation.role]}
                          </span>
                          <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                            Source: {recommendationSource === "riot-api" ? "Riot API" : "Local JSON"}
                          </span>
                          <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                            Patch {recommendation.patch}
                          </span>
                          {recommendation.fallback ? (
                            <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-amber-100">
                              Fallback
                            </span>
                          ) : null}
                        </div>
                        <h2 className="mt-3 text-2xl font-semibold text-white sm:text-[2rem]">{recommendation.label ?? "Recommended Build"}</h2>
                        <p className="mt-1 text-sm text-slate-400">
                          {recommendation.primaryStyle} + {recommendation.subStyle}
                        </p>
                        {lastBackendRefreshAt ? (
                          <p className="mt-2 text-xs text-slate-500">Last backend refresh: {formatDateTime(lastBackendRefreshAt)}</p>
                        ) : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <StatCard icon={<Flame size={16} />} label="Win Rate" value={`${recommendation.winRate.toFixed(1)}%`} />
                        <StatCard icon={<Gauge size={16} />} label="Pick Rate" value={`${recommendation.pickRate.toFixed(1)}%`} />
                        <StatCard icon={<Hash size={16} />} label="Matches" value={recommendation.gamesCount.toLocaleString("pl-PL")} />
                      </div>
                    </div>
                    {sampleSizeWarning ? <Message tone="amber">{sampleSizeWarning}</Message> : null}
                  </section>

                  <BuildRecommendationList
                    recommendations={buildOptions}
                    selectedKey={getRecommendationId(recommendation)}
                    onSelect={handleRecommendationSelect}
                    loading={backendDataLoading}
                  />

                  <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.75fr)]">
                    <section className="space-y-6">
                      <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
                        <div className="mb-5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Sparkles className="text-cyan-300" size={18} />
                            <h2 className="text-lg font-semibold text-white">Runes</h2>
                          </div>
                          <div className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-300">
                            Primary Setup
                          </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-3">
                          <RuneColumn title={recommendation.primaryStyle} values={runeGroups.primary} tone="cyan" />
                          <RuneColumn title={recommendation.subStyle} values={runeGroups.secondary} tone="emerald" />
                          <RuneColumn title="Stat shards" values={runeGroups.shards} tone="slate" />
                        </div>
                      </section>

                      <ItemAnalyticsSection items={itemAnalytics} loading={backendDataLoading} source={recommendationSource} />

                      <section className="grid gap-6 xl:grid-cols-2">
                        <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
                          <div className="mb-5 flex items-center gap-2">
                            <ClipboardList className="text-cyan-300" size={18} />
                            <h2 className="text-lg font-semibold text-white">Toughest Matchups</h2>
                          </div>
                          <AnalyticsList title="Hardest lanes" entries={matchupAnalytics.toughestMatchups} tone="rose" compact embedded loading={backendDataLoading} />
                        </section>

                        <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
                          <div className="mb-5 flex items-center gap-2">
                            <ChevronsUpDown className="text-cyan-300" size={18} />
                            <h2 className="text-lg font-semibold text-white">Skill Priority</h2>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {["Q", "W", "E"].map((skill, index) => (
                              <div key={skill} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-center transition hover:border-slate-600">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">Priority {index + 1}</p>
                                <p className="mt-2 text-2xl font-semibold text-white">{skill}</p>
                              </div>
                            ))}
                          </div>
                          <p className="mt-4 text-sm text-slate-400">Skill order UI placeholder for local builds.</p>
                        </section>
                      </section>
                    </section>

                    <section className="space-y-6">
                      <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
                        <div className="mb-5 flex items-center gap-2">
                          <Wand2 className="text-cyan-300" size={18} />
                          <h2 className="text-lg font-semibold text-white">Summoner Spells</h2>
                        </div>

                        <div className="grid gap-3">
                          {mappedSummonerSpells.map((spell) => (
                            <SummonerSpellCard key={spell.id} spell={spell} />
                          ))}
                        </div>

                        <button
                          type="button"
                          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={applyStatus === "checking" || applyStatus === "applying"}
                          onClick={() => void handleApplyToLol()}
                        >
                          {applyStatus === "checking" || applyStatus === "applying" ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                          Apply to League Client
                        </button>
                        <ApplyFlowStatus status={applyStatus} error={applyError} result={applyResult} />
                      </section>

                      <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
                        <div className="mb-5 flex items-center gap-2">
                          <Bell className="text-cyan-300" size={18} />
                          <h2 className="text-lg font-semibold text-white">Auto Actions</h2>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                          <StatusTile label="Auto runes" value={settings.autoRunes ? "Enabled" : "Disabled"} tone={settings.autoRunes ? "emerald" : "slate"} />
                          <StatusTile label="Auto summoners" value={settings.autoSummoners ? "Enabled" : "Disabled"} tone={settings.autoSummoners ? "emerald" : "slate"} />
                          <StatusTile label="Auto accept" value={settings.autoAccept.enabled ? "Enabled" : "Disabled"} tone={settings.autoAccept.enabled ? "emerald" : "slate"} />
                          <StatusTile label="Auto ban" value={settings.autoBan.enabled ? "Enabled" : "Disabled"} tone={settings.autoBan.enabled ? "emerald" : "slate"} />
                          <StatusTile label="Auto pick" value={settings.autoPick.enabled ? "Enabled" : "Disabled"} tone={settings.autoPick.enabled ? "emerald" : "slate"} />
                          <StatusTile label="Current phase" value={clientStatus.gameflowPhase ?? "Unknown"} tone={clientStatus.connected ? "cyan" : "amber"} />
                        </div>
                      </section>

                      <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
                        <div className="mb-5 flex items-center gap-2">
                          <ClipboardList className="text-cyan-300" size={18} />
                          <h2 className="text-lg font-semibold text-white">Diagnostics Snapshot</h2>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <StatusTile label="Backend" value={backendStatus.state} tone={backendStatus.state === "online" ? "emerald" : backendStatus.state === "checking" ? "cyan" : "amber"} />
                          <StatusTile label="Patch source" value={staticData?.status.patchSource ?? "Unknown"} tone="cyan" />
                          <StatusTile label="Cache status" value={staticData?.status.state ?? "Unknown"} tone="amber" />
                          <StatusTile label="Recommendations" value={String(buildOptions.length)} tone="slate" />
                          <StatusTile label="Champions" value={String(champions.length)} tone="slate" />
                          <StatusTile label="Last backend refresh" value={lastBackendRefreshAt ? formatDateTime(lastBackendRefreshAt) : "Not yet"} tone="slate" />
                          <StatusTile label="Backend data" value={backendDataLoading ? "Refreshing..." : "Ready"} tone={backendDataLoading ? "cyan" : "emerald"} />
                        </div>
                      </section>
                    </section>
                  </div>
                </>
              ) : (
                <section className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/60 p-8">
                  <div className="mx-auto max-w-xl text-center">
                    <h2 className="text-xl font-semibold text-white">No recommendation available.</h2>
                    <p className="mt-2 text-sm text-slate-400">This champion is available from Data Dragon, but there is no local build recommendation for the selected role yet.</p>
                  </div>
                </section>
              )}
            </section>
          </section>
        )}
      </div>
    </main>
  );
}

function resolveRecommendationOptions(champion: string, role: Role): Recommendation[] {
  return recommendationOptionsCache.get(`${champion}:${role}`) ?? [];
}

function validateRecommendation(recommendation: Recommendation | null, champion: string, staticData: RiotStaticData | null): string[] {
  if (!staticData) return [];

  const warnings: string[] = [];
  const championExists = staticData.champions.some((item) => item.name === champion);
  if (!championExists) warnings.push(`Champion ${champion} is not present in current Data Dragon data.`);

  if (!recommendation) {
    warnings.push(`No fallback recommendation found for ${champion}.`);
    return warnings;
  }

  for (const id of recommendation.selectedPerkIds) {
    if (!staticData.runes[String(id)]) warnings.push(`Rune ${id} is not present in current Data Dragon data.`);
  }

  for (const id of recommendation.summonerSpellIds) {
    if (!staticData.summonerSpells[String(id)]) warnings.push(`Summoner spell ${id} is not present in current Data Dragon data.`);
  }

  return [...new Set(warnings)];
}

function compareRecommendations(a: Recommendation, b: Recommendation) {
  return b.winRate - a.winRate || b.gamesCount - a.gamesCount;
}

function getRecommendationId(recommendation: Recommendation): string {
  return recommendation.buildId ?? [
    recommendation.champion,
    recommendation.role,
    recommendation.label,
    recommendation.primaryStyle,
    recommendation.subStyle,
    recommendation.selectedPerkIds.join("-"),
  ].join(":");
}

function InfoPanel({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-[0_10px_28px_rgba(0,0,0,0.16)]">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

const BuildRecommendationList = memo(function BuildRecommendationList({
  recommendations,
  selectedKey,
  onSelect,
  loading = false,
}: {
  recommendations: Recommendation[];
  selectedKey: string;
  onSelect: (key: string) => void;
  loading?: boolean;
}) {
  return (
    <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
        <Sparkles className="text-cyan-300" size={20} />
        <h2 className="text-lg font-semibold text-white">Build recommendations</h2>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
          {recommendations.length} builds
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {loading && recommendations.length === 0
          ? Array.from({ length: 3 }, (_, index) => (
              <div key={`build-skeleton-${index}`} className="h-36 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
            ))
          : null}
        {recommendations.map((item) => {
          const key = getRecommendationId(item);
          const active = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              className={[
                "rounded-2xl border p-4 text-left transition duration-150",
                active
                  ? "border-cyan-300 bg-cyan-300/10 text-cyan-50 shadow-[0_10px_32px_rgba(34,211,238,0.12)]"
                  : "border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-500 hover:bg-slate-900",
              ].join(" ")}
              onClick={() => onSelect(key)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{item.label ?? "Recommended"}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {roleLabels[item.role]} | {item.primaryStyle} + {item.subStyle}
                  </p>
                  <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">
                    {item.source === "riot-api" ? "Riot API" : "Local JSON"} | Patch {item.patch}
                  </p>
                </div>
                {item.fallback ? (
                  <span className="rounded border border-amber-300/30 px-2 py-0.5 text-xs text-amber-100">Fallback</span>
                ) : null}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <MiniMetric label="WR" value={`${item.winRate.toFixed(1)}%`} />
                <MiniMetric label="PR" value={`${item.pickRate.toFixed(1)}%`} />
                <MiniMetric label="Games" value={compactNumber(item.gamesCount)} />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
});

function ItemAnalyticsSection({
  items,
  loading,
  source,
}: {
  items: {
    coreItems: Array<{ id: string; name: string; iconUrl: string | null; description: string }>;
    fourthItemOptions: Array<{ id: string; name: string; iconUrl: string | null; description: string; winRate: number | null; matches: number | null }>;
    fifthItemOptions: Array<{ id: string; name: string; iconUrl: string | null; description: string; winRate: number | null; matches: number | null }>;
    sixthItemOptions: Array<{ id: string; name: string; iconUrl: string | null; description: string; winRate: number | null; matches: number | null }>;
  };
  loading: boolean;
  source: "riot-api" | "local-json";
}) {
  return (
    <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
        <Gauge className="text-cyan-300" size={20} />
        <h2 className="text-lg font-semibold text-white">Item Analytics</h2>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
          {source === "riot-api" ? "Riot API" : "Local fallback"}
        </span>
      </div>
      <p className="mb-5 text-sm text-slate-400">Core path and situational item branches for the selected build.</p>
      {loading ? <div className="mb-4 h-10 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" /> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <ItemSection title="Core Items" items={items.coreItems} emptyLabel="No item options available" />
        <ItemOptionsSection title="Fourth Item Options" items={items.fourthItemOptions} />
        <ItemOptionsSection title="Fifth Item Options" items={items.fifthItemOptions} />
        <ItemOptionsSection title="Sixth Item Options" items={items.sixthItemOptions} />
      </div>
    </section>
  );
}

function ItemSection({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: Array<{ id: string; name: string; iconUrl: string | null; description: string }>;
  emptyLabel: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="mb-4 text-sm font-semibold text-slate-200">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-slate-600 hover:bg-slate-900">
              <div className="flex items-center gap-3">
                {item.iconUrl ? <img src={item.iconUrl} alt="" className="h-10 w-10 rounded-md" /> : <div className="h-10 w-10 rounded-md bg-slate-800" />}
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{item.name}</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-300">{item.description || "Static local item recommendation."}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ItemOptionsSection({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; name: string; iconUrl: string | null; description: string; winRate: number | null; matches: number | null }>;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="mb-4 text-sm font-semibold text-slate-200">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">No item options available</p>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-slate-600 hover:bg-slate-900">
              <div className="flex items-start gap-3">
                {item.iconUrl ? <img src={item.iconUrl} alt="" className="h-10 w-10 rounded-md" /> : <div className="h-10 w-10 rounded-md bg-slate-800" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{item.name}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <MiniMetric label="WR" value={item.winRate !== null ? `${item.winRate.toFixed(1)}%` : "n/a"} />
                    <MiniMetric label="Games" value={item.matches !== null ? compactNumber(item.matches) : "n/a"} />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-300">{item.description || "Static local item recommendation."}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5">
      <p className="text-[11px] uppercase text-slate-500">{label}</p>
      <p className="mt-0.5 font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function compactNumber(value: number): string {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const runeMappingCache = new WeakMap<Record<string, RuneStaticData>, Map<string, MappedRune[]>>();
const spellMappingCache = new WeakMap<Record<string, SummonerSpellStaticData>, Map<string, MappedSummonerSpell[]>>();

function mapPerkIdsToRunesCached(runes: RiotStaticData["runes"] | null, perkIds: readonly number[]): MappedRune[] {
  if (!runes || perkIds.length === 0) {
    return [];
  }

  const key = perkIds.join(",");
  const cache = runeMappingCache.get(runes) ?? new Map<string, MappedRune[]>();
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const mapped = perkIds.map((id) => {
    const rune = runes?.[String(id)];
    return {
      id,
      name: rune?.name ?? "Unknown rune",
      iconUrl: rune?.iconUrl ?? null,
      styleName: rune?.styleName ?? null,
      exists: Boolean(rune),
    };
  });
  cache.set(key, mapped);
  runeMappingCache.set(runes, cache);
  return mapped;
}

function mapSpellIdsToSummonerSpellsCached(
  spells: RiotStaticData["summonerSpells"] | null,
  spellIds: readonly number[],
): MappedSummonerSpell[] {
  if (!spells || spellIds.length === 0) {
    return [];
  }

  const key = spellIds.join(",");
  const cache = spellMappingCache.get(spells) ?? new Map<string, MappedSummonerSpell[]>();
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const mapped = spellIds.map((id) => {
    const spell = spells?.[String(id)];
    return {
      id,
      name: spell?.name ?? "Unknown spell",
      iconUrl: spell?.iconUrl ?? null,
      description: spell?.description ?? null,
      exists: Boolean(spell),
    };
  });
  cache.set(key, mapped);
  spellMappingCache.set(spells, cache);
  return mapped;
}

function buildRecommendationIndex(recommendationsList: Recommendation[]) {
  const byChampion = new Map<string, Recommendation[]>();
  const rolesByChampion = new Map<string, Role[]>();
  const defaultRoleByChampion = new Map<string, Role>();

  for (const recommendation of recommendationsList) {
    const championBuilds = byChampion.get(recommendation.champion) ?? [];
    championBuilds.push(recommendation);
    byChampion.set(recommendation.champion, championBuilds);
  }

  for (const [champion, championBuilds] of byChampion.entries()) {
    championBuilds.sort(compareRecommendations);
    const roles = [...new Set(championBuilds.map((item) => item.role))];
    rolesByChampion.set(champion, roles);
    defaultRoleByChampion.set(champion, championBuilds[0]?.role ?? "middle");
  }

  return {
    byChampion,
    rolesByChampion,
    defaultRoleByChampion,
  };
}

function buildRecommendationOptionsCache(index: ReturnType<typeof buildRecommendationIndex>) {
  const cache = new Map<string, Recommendation[]>();

  for (const [champion, championBuilds] of index.byChampion.entries()) {
    const fallbackBuilds = championBuilds.filter((item) => item.fallback);

    for (const role of allRoles) {
      const exactBuilds = championBuilds.filter((item) => item.role === role);
      cache.set(
        `${champion}:${role}`,
        exactBuilds.length > 0 ? exactBuilds : fallbackBuilds.length > 0 ? fallbackBuilds : championBuilds,
      );
    }
  }

  return cache;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}

function isSameLeagueClientStatus(a: LeagueClientStatus, b: LeagueClientStatus): boolean {
  return (
    a.connected === b.connected &&
    a.gameflowPhase === b.gameflowPhase &&
    a.lockfilePath === b.lockfilePath &&
    a.error === b.error
  );
}

function isSameRiotApiStatus(a: RiotApiStatus, b: RiotApiStatus): boolean {
  return a.state === b.state && a.message === b.message && a.statusCode === b.statusCode;
}

function areLogsEqual(a: AppLogRecord[], b: AppLogRecord[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (JSON.stringify(a[index]) !== JSON.stringify(b[index])) {
      return false;
    }
  }
  return true;
}

function buildDiagnosticsSummary(
  logs: AppLogRecord[],
  currentGameflowPhase: string | null,
  dataStatus: DataDragonStatus | null,
  recommendationCount: number,
  championCount: number,
  backendStatus: BackendStatus,
) {
  return {
    gameflowPhase: currentGameflowPhase ?? "Unknown",
    lastAutoAccept: formatLatestLogSummary(findLatestLog(logs, ["auto_accept"])),
    lastAutoBan: formatLatestLogSummary(findLatestLog(logs, ["auto_ban"])),
    lastAutoPick: formatLatestLogSummary(findLatestLog(logs, ["auto_pick"])),
    lastRunesSet: formatLatestLogSummary(findLatestLog(logs, ["runes_set", "auto_runes"])),
    lastSummonersSet: formatLatestLogSummary(findLatestLog(logs, ["summoners_set", "auto_summoners"])),
    patchSource: dataStatus?.patchSource ?? "Unknown",
    cacheStatus: dataStatus?.state ?? "Unknown",
    recommendationCount,
    championCount,
    backendStatus: backendStatus.state,
  };
}

function findLatestLog(logs: AppLogRecord[], categories: string[]): AppLogRecord | null {
  for (const log of logs) {
    if (categories.includes(log.category)) {
      return log;
    }
  }
  return null;
}

function formatLatestLogSummary(log: AppLogRecord | null): string {
  if (!log) return "No activity yet";
  const timestamp = typeof log.createdAt === "string" && log.createdAt.length > 0 ? ` at ${log.createdAt}` : "";
  return `${log.message}${timestamp}`;
}

function sanitizeDiagnosticContext(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticContext(entry));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes("password") || normalizedKey.includes("authorization") || normalizedKey.includes("auth")) {
        return [key, "[redacted]"] as const;
      }
      return [key, sanitizeDiagnosticContext(nestedValue)] as const;
    });
    return Object.fromEntries(entries);
  }

  return value;
}

function Message({ tone, children }: { tone: "amber" | "rose" | "emerald" | "cyan"; children: ReactNode }) {
  const className = {
    cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100",
    amber: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    rose: "border-rose-400/30 bg-rose-400/10 text-rose-100",
    emerald: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  }[tone];

  return <p className={`mt-3 rounded-xl border p-3 text-sm ${className}`}>{children}</p>;
}

function AdminActionButton({
  title,
  active,
  disabled,
  onClick,
}: {
  title: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${
        disabled
          ? "cursor-not-allowed border-slate-800 bg-slate-900/60 text-slate-500"
          : "border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-300 hover:bg-slate-900"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {active ? <Loader2 size={16} className="animate-spin" /> : <MonitorUp size={16} />}
      {title}
    </button>
  );
}

function DataDragonBadge({ status, loadStatus }: { status: DataDragonStatus | null; loadStatus: LoadStatus }) {
  const ready = loadStatus === "ready";
  return (
    <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${ready ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" : "border-amber-400/25 bg-amber-400/10 text-amber-200"}`}>
      <RefreshCw size={16} className={loadStatus === "loading" ? "animate-spin" : ""} />
      Data Dragon: {status?.patch ?? loadStatus}
    </div>
  );
}

function RiotApiBadge({ status }: { status: RiotApiStatus }) {
  const className =
    status.state === "available"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : status.state === "error"
        ? "border-rose-400/25 bg-rose-400/10 text-rose-200"
        : "border-slate-600 bg-slate-900 text-slate-300";

  return (
    <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${className}`}>
      <PlugZap size={16} />
      Local Riot API: {status.state}
    </div>
  );
}

function BackendBadge({ status }: { status: BackendStatus }) {
  const className =
    status.state === "online"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : status.state === "checking"
        ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
        : "border-amber-400/25 bg-amber-400/10 text-amber-200";

  return (
    <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${className}`}>
      <MonitorUp size={16} />
      Backend: {status.state}
    </div>
  );
}

function ClientStatusBadge({ status }: { status: LeagueClientStatus }) {
  const connected = status.connected;
  return (
    <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${connected ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-amber-400/25 bg-amber-400/10 text-amber-200"}`}>
      <PlugZap size={16} />
      LoL: {connected ? status.gameflowPhase ?? "Connected" : "Disconnected"}
    </div>
  );
}

function ViewButton({ active, icon, children, onClick }: { active: boolean; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition ${active ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-slate-800/80 bg-slate-900/85 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.2)]">
      <div className="mb-2 flex items-center gap-2 text-cyan-300">
        {icon}
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      </div>
      <p className="text-2xl font-semibold text-white xl:text-[1.75rem]">{value}</p>
    </article>
  );
}

function RuneColumn({
  title,
  values,
  tone,
}: {
  title: string;
  values: MappedRune[];
  tone: "cyan" | "emerald" | "slate";
}) {
  const toneClass = {
    cyan: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
    emerald: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    slate: "border-slate-600 bg-slate-800 text-slate-100",
  }[tone];

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">{title}</h3>
      <div className="grid gap-2">
        {values.map((rune, index) => {
          return (
            <div key={`${rune.id}-${index}`} className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-sm transition hover:brightness-110 ${toneClass}`}>
              {rune.iconUrl ? <img src={rune.iconUrl} alt="" className="h-8 w-8 rounded" /> : <div className="h-8 w-8 rounded bg-slate-950/60" />}
              <div className="min-w-0">
                <p className="truncate font-semibold">{rune.name}</p>
                {rune.styleName ? <p className="text-xs opacity-70">{rune.styleName}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummonerSpellCard({
  spell,
}: {
  spell: MappedSummonerSpell;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 transition hover:border-slate-600 hover:bg-slate-900">
      <div className="flex min-w-0 items-center gap-3">
        {spell.iconUrl ? <img src={spell.iconUrl} alt="" className="h-10 w-10 rounded-md" /> : <div className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-300 text-sm font-bold text-slate-950">{spell.id}</div>}
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">{spell.name}</p>
          {spell.description ? <p className="line-clamp-2 text-sm text-slate-400">{spell.description}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ApplyFlowStatus({ status, error, result }: { status: ApplyStatus; error: string | null; result: ApplyRecommendationResponse | null }) {
  if (status === "idle") return <p className="mt-3 text-center text-sm text-slate-400">Gotowe do ustawienia run i spelli.</p>;
  if (status === "checking") return <p className="mt-3 text-center text-sm text-cyan-200">Sprawdzam klienta LoL i champion select...</p>;
  if (status === "applying") return <p className="mt-3 text-center text-sm text-cyan-200">Ustawiam runy oraz summoner spells...</p>;
  if (status === "success" && result) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">
        <p className="font-semibold">Sukces. Ustawiono w League Client.</p>
        <p className="mt-1">Rune page: {result.runePageName} | Spells: {result.spell1Id}, {result.spell2Id}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 flex gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-100">
      <AlertCircle className="mt-0.5 shrink-0" size={16} />
      <p>{error ?? "Nie udalo sie ustawic rekomendacji."}</p>
    </div>
  );
}

function OnboardingScreen({
  onContinue,
  status,
  error,
}: {
  onContinue: () => void;
  status: SaveStatus;
  error: string | null;
}) {
  return (
    <section className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-800/80 bg-slate-950/75 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:p-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_320px]">
        <div>
          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
            First launch
          </span>
          <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">How Liga works</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
            Liga is a local desktop helper for League of Legends champion select. It works only with the local League Client and keeps the setup in your own app settings.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <OnboardingCard
              title="League Client required"
              body="The app works only when League Client is running. Without the client, Liga can show local data but cannot detect champion select or apply anything."
            />
            <OnboardingCard
              title="Auto runes"
              body="Auto runes sets your rune page during champion select based on the currently selected recommendation."
            />
            <OnboardingCard
              title="Auto summoners"
              body="Auto summoners sets your summoner spells during champion select using the currently selected recommendation."
            />
            <OnboardingCard
              title="Optional automation"
              body="Auto accept, auto ban and auto pick are optional. They are disabled by default and you must enable them yourself in Settings."
            />
            <OnboardingCard
              title="Local League Client API"
              body="Liga talks only to the local League Client API and local app storage. There is no required online backend for the core app flow."
            />
            <OnboardingCard
              title="Lockfile safety"
              body="The app uses the League lockfile to connect locally, but it does not store the lockfile password in app settings or diagnostics."
            />
          </div>
        </div>

        <aside className="h-fit rounded-3xl border border-slate-800/80 bg-slate-900/80 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex items-center gap-2">
            <AlertCircle className="text-cyan-300" size={20} />
            <h2 className="text-lg font-semibold text-white">Before you start</h2>
          </div>
          <ul className="space-y-3 text-sm leading-6 text-slate-300">
            <li>Run League Client before expecting live detection.</li>
            <li>Auto runes can stay on if you want automatic rune pages.</li>
            <li>Auto accept, auto ban and auto pick stay off until you enable them in Settings.</li>
            <li>You can change every automation option later.</li>
          </ul>

          <button
            type="button"
            className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={status === "saving"}
            onClick={onContinue}
          >
            {status === "saving" ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
            I understand
          </button>

          {status === "error" || error ? <Message tone="rose">{error ?? "Could not save onboarding state."}</Message> : null}
        </aside>
      </div>
    </section>
  );
}

function OnboardingCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-[0_12px_32px_rgba(0,0,0,0.18)]">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </article>
  );
}

function SettingsScreen({ settings, champions, status, error, onChange, onSave }: { settings: AppSettings; champions: ChampionStaticData[]; status: SaveStatus; error: string | null; onChange: (patch: Partial<AppSettings>) => void; onSave: () => void }) {
  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
         <Panel icon={<Wand2 className="text-cyan-300" size={20} />} title="Automation">
           <div className="grid gap-3">
             <ToggleRow title="Auto set runes" checked={settings.autoRunes} onChange={(value) => onChange({ autoRunes: value })} />
             <ToggleRow title="Auto set summoners" checked={settings.autoSummoners} onChange={(value) => onChange({ autoSummoners: value })} />
             <ToggleRow title="Auto accept" checked={settings.autoAccept.enabled} onChange={(value) => onChange({ autoAccept: { ...settings.autoAccept, enabled: value } })} />
             <ToggleRow title="Auto ban" checked={settings.autoBan.enabled} onChange={(value) => onChange({ autoBan: { ...settings.autoBan, enabled: value } })} />
             <ToggleRow title="Auto pick" checked={settings.autoPick.enabled} onChange={(value) => onChange({ autoPick: { ...settings.autoPick, enabled: value } })} />
           </div>
         </Panel>
         <Panel icon={<Gamepad2 className="text-cyan-300" size={20} />} title="Pick">
           <div className="grid gap-3">
             <ToggleRow title="Confirm pick" checked={settings.autoPick.confirmPick} onChange={(value) => onChange({ autoPick: { ...settings.autoPick, confirmPick: value } })} />
             <label className="block">
               <span className="mb-2 block text-sm font-medium text-slate-300">Preferred Pick Champion</span>
               <div className="relative">
                 <select
                   className="h-11 w-full appearance-none rounded-md border border-slate-700 bg-slate-900 px-3 pr-10 text-sm text-white outline-none transition focus:border-cyan-300"
                   value={settings.autoPick.preferredPickChampionId || ""}
                   onChange={(event) => {
                     const value = event.target.value;
                     onChange({
                       autoPick: {
                         ...settings.autoPick,
                         preferredPickChampionId: value ? parseInt(value) : null,
                       },
                     });
                   }}
                 >
                   <option value="">Select a champion</option>
                   {champions.map((champion: ChampionStaticData) => (
                     <option key={champion.key} value={champion.key}>
                       {champion.name}
                     </option>
                   ))}
                 </select>
                 <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
               </div>
             </label>
             {[0, 1, 2].map((index) => (
               <label key={index} className="block">
                 <span className="mb-2 block text-sm font-medium text-slate-300">Backup Pick Champion {index + 1}</span>
                 <div className="relative">
                   <select
                     className="h-11 w-full appearance-none rounded-md border border-slate-700 bg-slate-900 px-3 pr-10 text-sm text-white outline-none transition focus:border-cyan-300"
                     value={settings.autoPick.backupPickChampionIds[index] || ""}
                     onChange={(event) => {
                       const value = event.target.value ? parseInt(event.target.value) : null;
                       const next = [...settings.autoPick.backupPickChampionIds];
                       if (value === null) {
                         next.splice(index, 1);
                       } else {
                         next[index] = value;
                       }
                       onChange({
                         autoPick: {
                           ...settings.autoPick,
                           backupPickChampionIds: next.filter((id): id is number => Number.isInteger(id) && id > 0),
                         },
                       });
                     }}
                   >
                     <option value="">Select a champion</option>
                     {champions.map((champion: ChampionStaticData) => (
                       <option key={champion.key} value={champion.key}>
                         {champion.name}
                       </option>
                     ))}
                   </select>
                   <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                 </div>
               </label>
             ))}
           </div>
         </Panel>
         <Panel icon={<Gamepad2 className="text-cyan-300" size={20} />} title="Bans">
           <div className="grid gap-3">
             <ToggleRow title="Confirm ban" checked={settings.autoBan.confirmBeforeBan} onChange={(value) => onChange({ autoBan: { ...settings.autoBan, confirmBeforeBan: value } })} />
             <label className="block">
               <span className="mb-2 block text-sm font-medium text-slate-300">Main Ban Champion</span>
               <div className="relative">
                 <select
                   className="h-11 w-full appearance-none rounded-md border border-slate-700 bg-slate-900 px-3 pr-10 text-sm text-white outline-none transition focus:border-cyan-300"
                   value={settings.autoBan.preferredBanChampionId || ""}
                   onChange={(event) => {
                     const value = event.target.value;
                     onChange({ 
                       autoBan: { 
                         ...settings.autoBan, 
                         preferredBanChampionId: value ? parseInt(value) : null 
                       } 
                     });
                   }}
                 >
                   <option value="">Select a champion</option>
                   {champions.map((champion: ChampionStaticData) => (
                     <option key={champion.key} value={champion.key}>
                       {champion.name}
                     </option>
                   ))}
                 </select>
                 <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
               </div>
             </label>
             <label className="block">
               <span className="mb-2 block text-sm font-medium text-slate-300">Backup Ban Champion</span>
               <div className="relative">
                 <select
                   className="h-11 w-full appearance-none rounded-md border border-slate-700 bg-slate-900 px-3 pr-10 text-sm text-white outline-none transition focus:border-cyan-300"
                   value={settings.autoBan.backupBanChampionId || ""}
                   onChange={(event) => {
                     const value = event.target.value;
                     onChange({ 
                       autoBan: { 
                         ...settings.autoBan, 
                         backupBanChampionId: value ? parseInt(value) : null 
                       } 
                     });
                   }}
                 >
                   <option value="">Select a champion</option>
                   {champions.map((champion: ChampionStaticData) => (
                     <option key={champion.key} value={champion.key}>
                       {champion.name}
                     </option>
                   ))}
                 </select>
                 <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
               </div>
             </label>
           </div>
         </Panel>
        <Panel icon={<Gamepad2 className="text-cyan-300" size={20} />} title="Preferences">
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField label="Preferred role" value={settings.preferredRole} options={Object.entries(roleLabels)} onChange={(value) => onChange({ preferredRole: value as Role })} />
            <SelectField
              label="Language"
              value={settings.language}
              options={[
                ["en_US", "English"],
                ["pl_PL", "Polski"],
                ["de_DE", "Deutsch"],
                ["fr_FR", "Francais"],
                ["es_ES", "Espanol"],
              ]}
              onChange={(value) => onChange({ language: value })}
            />
          </div>
        </Panel>
        <Panel icon={<Bell className="text-cyan-300" size={20} />} title="System">
          <div className="grid gap-3">
            <ToggleRow title="Notifications" checked={settings.notifications} onChange={(value) => onChange({ notifications: value })} />
          </div>
        </Panel>
      </div>

      <aside className="h-fit rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)] xl:sticky xl:top-5">
        <div className="mb-4 flex items-center gap-2">
          <MonitorUp className="text-cyan-300" size={20} />
          <h2 className="text-lg font-semibold text-white">Settings status</h2>
        </div>
        <button
          type="button"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-cyan-300 px-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={status === "saving"}
          onClick={onSave}
        >
          {status === "saving" ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          Save settings
        </button>
        {status === "saved" ? <Message tone="emerald">Settings saved.</Message> : null}
        {status === "error" || error ? <Message tone="rose">{error ?? "Could not save settings."}</Message> : null}
      </aside>
    </section>
  );
}

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="mb-5 flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DiagnosticsScreen({
  logs,
  error,
  dataStatus,
  riotApiStatus,
  backendStatus,
  backendDiagnostics,
  backendJobStatus,
  backendVersion,
  recommendationCount,
  championCount,
  currentGameflowPhase,
  diagnosticsSummary,
  matchupAnalytics,
  onRefresh,
  onRefreshData,
  onClear,
  onClearRiotCache,
  onTestRiotApi,
  backendAdminAction,
  backendAdminError,
  onSeedRankedAccounts,
  onUpdateStats,
  onAnalyzeStats,
  onFullRefresh,
}: {
  logs: AppLogRecord[];
  error: string | null;
  dataStatus: DataDragonStatus | null;
  riotApiStatus: RiotApiStatus;
  backendStatus: BackendStatus;
  backendDiagnostics: BackendDiagnosticsResponse | null;
  backendJobStatus: BackendJobStatusResponse;
  backendVersion: BackendVersionResponse | null;
  recommendationCount: number;
  championCount: number;
  currentGameflowPhase: string | null;
  diagnosticsSummary: ReturnType<typeof buildDiagnosticsSummary>;
  matchupAnalytics: ReturnType<typeof buildMatchupAnalytics>;
  onRefresh: () => void;
  onRefreshData: () => void;
  onClear: () => void;
  onClearRiotCache: () => void;
  onTestRiotApi: () => void;
  backendAdminAction: BackendAdminAction;
  backendAdminError: string | null;
  onSeedRankedAccounts: () => void;
  onUpdateStats: () => void;
  onAnalyzeStats: () => void;
  onFullRefresh: () => void;
}) {
  const counts = logs.reduce(
    (acc, log) => {
      if (log.level === "error") acc.errors += 1;
      if (log.level === "warn") acc.warnings += 1;
      return acc;
    },
    { errors: 0, warnings: 0 },
  );
  const backendOnline = backendStatus.state === "online";

  return (
    <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="h-fit rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)] xl:sticky xl:top-5">
        <div className="mb-5 flex items-center gap-2">
          <ClipboardList className="text-cyan-300" size={20} />
          <h2 className="text-lg font-semibold text-white">Diagnostics</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <DiagnosticStat label="Gameflow" value={currentGameflowPhase ?? "Unknown"} tone="cyan" />
          <DiagnosticStat label="Total logs" value={logs.length.toString()} tone="cyan" />
          <DiagnosticStat label="Warnings" value={counts.warnings.toString()} tone="amber" />
          <DiagnosticStat label="Errors" value={counts.errors.toString()} tone="rose" />
          <DiagnosticStat label="Recommendations" value={recommendationCount.toString()} tone="cyan" />
          <DiagnosticStat label="Champions" value={championCount.toString()} tone="cyan" />
          <DiagnosticStat label="Tracked Accounts" value={String(backendDiagnostics?.trackedAccountsCount ?? 0)} tone="cyan" />
          <DiagnosticStat label="Match Records" value={String(backendDiagnostics?.matchRecordsCount ?? 0)} tone="cyan" />
          <DiagnosticStat label="Current Job" value={backendJobStatus.currentJob ?? "Idle"} tone={backendJobStatus.running ? "cyan" : "amber"} />
          <DiagnosticStat label="Progress" value={`${backendJobStatus.progress}%`} tone={backendJobStatus.running ? "cyan" : "amber"} />
          <DiagnosticStat label="Processed Matches" value={String(backendJobStatus.processedMatches)} tone={backendJobStatus.running ? "cyan" : "amber"} />
          <DiagnosticStat label="Current Champion" value={backendJobStatus.currentChampion ?? "None"} tone={backendJobStatus.running ? "cyan" : "amber"} />
          <DiagnosticStat label="Current Role" value={backendJobStatus.currentRole ?? "None"} tone={backendJobStatus.running ? "cyan" : "amber"} />
        </div>
        <div className="mt-5 grid gap-3">
          <StatusTile label="Last auto accept" value={diagnosticsSummary.lastAutoAccept} tone="slate" />
          <StatusTile label="Last auto ban" value={diagnosticsSummary.lastAutoBan} tone="slate" />
          <StatusTile label="Last auto pick" value={diagnosticsSummary.lastAutoPick} tone="slate" />
          <StatusTile label="Last runes set" value={diagnosticsSummary.lastRunesSet} tone="slate" />
          <StatusTile label="Last summoners set" value={diagnosticsSummary.lastSummonersSet} tone="slate" />
        </div>
        <div className="mt-5 grid gap-2">
          <button type="button" className="h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:bg-slate-900" onClick={onRefresh}>
            Refresh logs
          </button>
          <button type="button" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:bg-slate-900" onClick={onRefreshData}>
            <RefreshCw size={16} />
            Refresh Riot/Data Dragon data
          </button>
          <button type="button" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:bg-slate-900" onClick={onTestRiotApi}>
            <PlugZap size={16} />
            Test Riot API
          </button>
          <button type="button" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/20" onClick={onClearRiotCache}>
            <Trash2 size={16} />
            Clear Riot/Data Dragon cache
          </button>
          <button type="button" className="h-11 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20" onClick={onClear}>
            Clear logs
          </button>
        </div>
        <Message tone={riotApiStatus.state === "error" ? "rose" : riotApiStatus.state === "available" ? "emerald" : "amber"}>
          Local Riot API: {riotApiStatus.message}
        </Message>
        {backendOnline ? (
          <Message tone="emerald">Remote stats source: Railway backend</Message>
        ) : null}
        <Message tone={backendStatus.state === "online" ? "emerald" : backendStatus.state === "checking" ? "cyan" : "amber"}>
          Backend: {backendStatus.message}
        </Message>
        <Message tone="cyan">Backend URL: {backendStatus.url || "Not configured"}</Message>
        <Message tone="cyan">Health URL: {backendStatus.healthUrl || "Not configured"}</Message>
        {backendVersion ? (
          <Message tone="cyan">
            Backend version: {backendVersion.version} | build {formatDateTime(backendVersion.buildTime)} | stats{" "}
            {backendVersion.statsUpdatedAt ? formatDateTime(backendVersion.statsUpdatedAt) : "never"}
          </Message>
        ) : null}
        <Message tone="cyan">Last backend health response: {backendStatus.lastHealthResponse}</Message>
        {backendStatus.lastHealthError ? <Message tone="rose">Last backend health error: {backendStatus.lastHealthError}</Message> : null}
        {backendDiagnostics?.lastFullRefresh ? (
          <Message tone="cyan">
            Last full refresh: {backendDiagnostics.lastFullRefresh.status} | duration {backendDiagnostics.lastFullRefresh.durationMs ?? 0}ms
          </Message>
        ) : null}
        {backendDiagnostics?.rateLimitStatus ? (
          <Message tone={backendDiagnostics.rateLimitStatus.active ? "amber" : "emerald"}>
            Rate limit: {backendDiagnostics.rateLimitStatus.active ? "active" : "idle"}
          </Message>
        ) : null}
        {backendAdminAction ? (
          <Message tone="cyan">Backend refresh progress: {backendAdminAction}</Message>
        ) : null}
        {backendJobStatus.running ? (
          <Message tone="cyan">
            Analyzer: {backendJobStatus.currentJob ?? "running"} | {backendJobStatus.progress}% | {backendJobStatus.processedMatches} matches
            {backendJobStatus.estimatedRemainingMinutes ? ` | ~${backendJobStatus.estimatedRemainingMinutes} min left` : ""}
          </Message>
        ) : null}
        {dataStatus?.message ? <Message tone="emerald">Data Dragon: {dataStatus.message}</Message> : null}
        {dataStatus ? <Message tone="cyan">Patch source: {dataStatus.patchSource}</Message> : null}
        {dataStatus ? <Message tone="cyan">Cache status: {dataStatus.state}</Message> : null}
        {error ? <Message tone="rose">{error}</Message> : null}
        {backendAdminError ? <Message tone="rose">{backendAdminError}</Message> : null}
      </aside>

      <section className="space-y-6">
        <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Backend Admin</h2>
              <p className="mt-1 text-sm text-slate-400">Manual backend jobs for Riot API sync and analytics refresh.</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
              backendOnline
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                : "border-amber-400/30 bg-amber-400/10 text-amber-100"
            }`}>
              Backend {backendOnline ? "Online" : "Offline"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DiagnosticStat label="Tracked Accounts" value={String(backendDiagnostics?.trackedAccountsCount ?? 0)} tone="cyan" />
            <DiagnosticStat label="Matches" value={String(backendDiagnostics?.matchRecordsCount ?? 0)} tone="cyan" />
            <DiagnosticStat label="Recommendations" value={String(backendDiagnostics?.recommendationStatsCount ?? 0)} tone="cyan" />
            <DiagnosticStat label="Item Stats" value={String(backendDiagnostics?.itemStatsCount ?? 0)} tone="cyan" />
            <DiagnosticStat label="Matchups" value={String(backendDiagnostics?.matchupStatsCount ?? 0)} tone="cyan" />
            <DiagnosticStat label="Current Job" value={backendJobStatus.currentJob ?? "Idle"} tone={backendJobStatus.running ? "cyan" : "amber"} />
            <DiagnosticStat label="Progress" value={`${backendJobStatus.progress}%`} tone={backendJobStatus.running ? "cyan" : "amber"} />
            <DiagnosticStat label="Processed Matches" value={String(backendJobStatus.processedMatches)} tone={backendJobStatus.running ? "cyan" : "amber"} />
            <DiagnosticStat label="Current Champion" value={backendJobStatus.currentChampion ?? "None"} tone={backendJobStatus.running ? "cyan" : "amber"} />
            <DiagnosticStat label="Current Role" value={backendJobStatus.currentRole ?? "None"} tone={backendJobStatus.running ? "cyan" : "amber"} />
            <DiagnosticStat label="Backend Version" value={backendVersion?.version ?? "Unknown"} tone="cyan" />
            <DiagnosticStat label="Stats Updated" value={backendVersion?.statsUpdatedAt ? formatDateTime(backendVersion.statsUpdatedAt) : "Never"} tone="cyan" />
            <DiagnosticStat label="Backend URL" value={backendStatus.url || "Not configured"} tone="cyan" />
            <DiagnosticStat label="Health URL" value={backendStatus.healthUrl || "Not configured"} tone="cyan" />
            <DiagnosticStat label="Health Response" value={backendStatus.lastHealthResponse} tone="cyan" />
            <DiagnosticStat label="Health Error" value={backendStatus.lastHealthError ?? "None"} tone={backendStatus.lastHealthError ? "rose" : "cyan"} />
            <DiagnosticStat
              label="Last Full Refresh"
              value={backendDiagnostics?.lastFullRefresh?.finishedAt ?? backendDiagnostics?.lastFullRefresh?.startedAt ?? "Never"}
              tone="cyan"
            />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AdminActionButton
              title="Seed ranked accounts"
              active={backendAdminAction === "seed"}
              disabled={!backendOnline || backendAdminAction !== null}
              onClick={onSeedRankedAccounts}
            />
            <AdminActionButton
              title="Update stats"
              active={backendAdminAction === "update"}
              disabled={!backendOnline || backendAdminAction !== null}
              onClick={onUpdateStats}
            />
            <AdminActionButton
              title="Analyze stats"
              active={backendAdminAction === "analyze"}
              disabled={!backendOnline || backendAdminAction !== null}
              onClick={onAnalyzeStats}
            />
            <AdminActionButton
              title="Full refresh"
              active={backendAdminAction === "full-refresh"}
              disabled={!backendOnline || backendAdminAction !== null}
              onClick={onFullRefresh}
            />
          </div>
        </section>

        <section className="grid gap-6 2xl:grid-cols-3">
          <AnalyticsList title="Toughest Matchups" entries={matchupAnalytics.toughestMatchups} tone="rose" embedded />
          <AnalyticsList title="Best Picks" entries={matchupAnalytics.bestPicks} tone="emerald" embedded />
          <AnalyticsList title="Worst Picks" entries={matchupAnalytics.worstPicks} tone="amber" embedded />
        </section>
        <section className="rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-white">Application logs</h2>
          </div>
          <div className="max-h-[620px] space-y-3 overflow-auto pr-1">
            {logs.length === 0 ? (
              <div className="rounded-md border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">No logs yet.</div>
            ) : (
              logs.map((log) => <LogRow key={log.id ?? `${log.createdAt}-${log.message}`} log={log} />)
            )}
          </div>
        </section>
      </section>
    </section>
  );
}

function DiagnosticStat({ label, value, tone }: { label: string; value: string; tone: "cyan" | "amber" | "rose" }) {
  const toneClass = {
    cyan: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
    amber: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    rose: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function StatusTile({ label, value, tone }: { label: string; value: string; tone: "emerald" | "amber" | "cyan" | "slate" }) {
  const toneClass = {
    emerald: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    cyan: "border-cyan-400/25 bg-cyan-400/10 text-cyan-100",
    slate: "border-slate-700 bg-slate-900/80 text-slate-100",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-2 text-sm font-semibold leading-5">{value}</p>
    </div>
  );
}

function AnalyticsList({
  title,
  entries,
  tone,
  compact = false,
  embedded = false,
  loading = false,
}: {
  title: string;
  entries: AnalyticsEntry[];
  tone: "emerald" | "amber" | "rose";
  compact?: boolean;
  embedded?: boolean;
  loading?: boolean;
}) {
  const toneClass = {
    emerald: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    rose: "border-rose-400/25 bg-rose-400/10 text-rose-100",
  }[tone];

  return (
    <section className={`${embedded ? "rounded-none border-none bg-transparent p-0 shadow-none" : "rounded-3xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]"}`}>
      <h2 className="mb-4 text-lg font-semibold text-white">{title}</h2>
      <div className="grid gap-2">
        {loading && entries.length === 0 ? (
          Array.from({ length: 3 }, (_, index) => (
            <div key={`${title}-skeleton-${index}`} className="h-20 animate-pulse rounded-xl border border-slate-800 bg-slate-900/60" />
          ))
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">No analytics available.</div>
        ) : (
          entries.map((entry) => (
            <div key={`${title}-${entry.champion}-${entry.role}`} className={`rounded-xl border p-3 transition hover:brightness-110 ${toneClass}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{entry.champion}</p>
                  <p className="text-xs opacity-80">{roleLabels[entry.role]}{entry.label ? ` | ${entry.label}` : ""}</p>
                </div>
                <div className={`text-right ${compact ? "text-xs" : "text-sm"}`}>
                  <p>{entry.winRate.toFixed(1)}% WR</p>
                  <p className="opacity-80">{compactNumber(entry.gamesCount)} games</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function LogRow({ log }: { log: AppLogRecord }) {
  const levelClass =
    {
      debug: "border-slate-600 bg-slate-800 text-slate-100",
      info: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
      warn: "border-amber-300/30 bg-amber-300/10 text-amber-100",
      error: "border-rose-300/30 bg-rose-300/10 text-rose-100",
    }[log.level] ?? "border-slate-600 bg-slate-800 text-slate-100";

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-xs font-bold uppercase ${levelClass}`}>{log.level}</span>
        <span className="rounded border border-slate-700 px-2 py-0.5 text-xs font-medium text-slate-300">{log.category}</span>
        <span className="text-xs text-slate-500">{log.createdAt ?? ""}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-white">{log.message}</p>
      {log.context ? <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-300">{JSON.stringify(sanitizeDiagnosticContext(log.context), null, 2)}</pre> : null}
    </article>
  );
}

function ToggleRow({ title, checked, onChange }: { title: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-slate-800 bg-slate-900/70 p-4">
      <span className="block font-semibold text-white">{title}</span>
      <input className="sr-only" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className={`relative h-6 w-11 shrink-0 rounded-full border transition ${checked ? "border-cyan-300 bg-cyan-300" : "border-slate-600 bg-slate-800"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? "left-5" : "left-0.5"}`} />
      </span>
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">{label}</span>
      <div className="relative">
        <select className="h-11 w-full appearance-none rounded-md border border-slate-700 bg-slate-900 px-3 pr-10 text-sm text-white outline-none transition focus:border-cyan-300" value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ))}
        </select>
        <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
      </div>
    </label>
  );
}

function OverlayApp({ staticData }: { staticData: RiotStaticData | null }) {
  const [payload, setPayload] = useState<OverlayPayload>(() => readOverlayPayload());

  useEffect(() => {
    const unlistenPromise = listen<OverlayPayload>("overlay:update", (event) => setPayload(event.payload));
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const recommendation = payload.recommendation;
  const patch = payload.dataDragonPatch ?? staticData?.patch ?? "loading";
  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
        <p className="text-sm text-cyan-300">{patch}</p>
        <h1 className="mt-1 text-2xl font-bold">{recommendation.champion}</h1>
        <p className="mt-1 text-sm text-slate-400">{roleLabels[recommendation.role]}</p>
      </div>
      <section className="mt-4 rounded-lg border border-slate-800 bg-slate-900/80 p-4">
        <h2 className="text-sm font-semibold text-slate-300">Runes</h2>
        <div className="mt-3 grid gap-2">
          {recommendation.selectedPerkIds.slice(0, 6).map((id) => (
            <div key={id} className="flex items-center gap-2 rounded-md bg-slate-800 p-2 text-sm">
              {staticData?.runes[String(id)]?.iconUrl ? <img src={staticData.runes[String(id)].iconUrl ?? ""} alt="" className="h-6 w-6 rounded" /> : null}
              {staticData?.runes[String(id)]?.name ?? `Rune ${id}`}
            </div>
          ))}
        </div>
      </section>
      <section className="mt-4 rounded-lg border border-slate-800 bg-slate-900/80 p-4">
        <h2 className="text-sm font-semibold text-slate-300">Summoner spells</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {recommendation.summonerSpellIds.map((id) => (
            <div key={id} className="rounded-md bg-slate-800 p-3 text-sm">
              {staticData?.summonerSpells[String(id)]?.name ?? `Spell ${id}`}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function readOverlayPayload(): OverlayPayload {
  const fallbackRecommendation = data[0];
  const fallback: OverlayPayload = {
    recommendation: fallbackRecommendation,
    clientStatus: emptyClientStatus,
    dataDragonPatch: null,
    patchSource: null,
    buildItems: getBuildItems(fallbackRecommendation),
  };

  try {
    const raw = localStorage.getItem(overlayStorageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as OverlayPayload;
    return parsed.recommendation ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getBuildItems(recommendation: Recommendation): string[] {
  const byRole: Record<Role, string[]> = {
    top: ["Doran's Shield", "Plated Steelcaps", "Black Cleaver", "Sterak's Gage"],
    jungle: ["Jungle Pet", "Ionian Boots", "Eclipse", "Black Cleaver"],
    middle: ["Doran's Ring", "Sorcerer's Shoes", "Luden's Companion", "Rabadon's Deathcap"],
    bottom: ["Doran's Blade", "Berserker's Greaves", "Infinity Edge", "Lord Dominik's Regards"],
    utility: ["World Atlas", "Ionian Boots", "Locket of the Iron Solari", "Redemption"],
  };
  return byRole[recommendation.role];
}

function buildItemAnalytics(
  recommendation: Recommendation | null,
  items: Record<string, ItemStaticData> | null,
  backendItems: BackendItemsResponse | null,
): {
  coreItems: Array<{ id: string; name: string; iconUrl: string | null; description: string }>;
  fourthItemOptions: Array<{ id: string; name: string; iconUrl: string | null; description: string; winRate: number | null; matches: number | null }>;
  fifthItemOptions: Array<{ id: string; name: string; iconUrl: string | null; description: string; winRate: number | null; matches: number | null }>;
  sixthItemOptions: Array<{ id: string; name: string; iconUrl: string | null; description: string; winRate: number | null; matches: number | null }>;
} {
  const empty = {
    coreItems: [],
    fourthItemOptions: [],
    fifthItemOptions: [],
    sixthItemOptions: [],
  };
  if (!recommendation) return empty;

  if (backendItems && hasBackendItems(backendItems)) {
    return buildBackendItemAnalytics(backendItems, items);
  }

  const configured = itemAnalyticsIndex.get(buildItemAnalyticsKey(recommendation.champion, recommendation.role));
  const fallbackNames = getBuildItems(recommendation);

  const coreItemsSource =
    configured?.coreItems?.slice(0, 3) ??
    configured?.items?.slice(0, 3) ??
    fallbackNames.slice(0, 3).map((name) => ({ name, description: "" }));

  const fourthSource =
    configured?.fourthItemOptions ??
    buildFallbackItemOptions(configured?.items?.[3]?.name ?? fallbackNames[3], recommendation, 4);
  const fifthSource =
    configured?.fifthItemOptions ??
    buildFallbackItemOptions(undefined, recommendation, 5);
  const sixthSource =
    configured?.sixthItemOptions ??
    buildFallbackItemOptions(undefined, recommendation, 6);

  return {
    coreItems: coreItemsSource.map((item, index) => resolveItemCard(item, items, `core-${index}`)),
    fourthItemOptions: fourthSource.map((item, index) => resolveItemOptionCard(item, items, `fourth-${index}`)),
    fifthItemOptions: fifthSource.map((item, index) => resolveItemOptionCard(item, items, `fifth-${index}`)),
    sixthItemOptions: sixthSource.map((item, index) => resolveItemOptionCard(item, items, `sixth-${index}`)),
  };
}

function buildItemAnalyticsIndex(entries: ItemAnalyticsEntry[]) {
  return new Map(entries.map((entry) => [buildItemAnalyticsKey(entry.champion, entry.role), entry] as const));
}

function buildItemAnalyticsKey(champion: string, role: Role): string {
  return `${champion}:${role}`;
}

function resolveItemCard(
  configuredItem: { name: string; description?: string },
  items: Record<string, ItemStaticData> | null,
  fallbackId: string,
) {
  const item = items ? Object.values(items).find((candidate) => candidate.name === configuredItem.name) ?? null : null;
  return {
    id: String(item?.id ?? fallbackId),
    name: configuredItem.name,
    iconUrl: item?.iconUrl ?? null,
    description: configuredItem.description || item?.plaintext || item?.description || "",
  };
}

function resolveItemOptionCard(
  configuredItem: { name: string; description?: string; winRate?: number; matches?: number },
  items: Record<string, ItemStaticData> | null,
  fallbackId: string,
) {
  const resolved = resolveItemCard(configuredItem, items, fallbackId);
  return {
    ...resolved,
    winRate: configuredItem.winRate ?? null,
    matches: configuredItem.matches ?? null,
  };
}

function buildFallbackItemOptions(
  preferredItemName: string | undefined,
  recommendation: Recommendation,
  slot: 4 | 5 | 6,
): Array<{ name: string; description: string; winRate: number; matches: number }> {
  const pool = fallbackItemOptionPool[recommendation.role][slot];
  const names = preferredItemName ? [preferredItemName, ...pool.filter((name) => name !== preferredItemName)] : pool;
  return names.slice(0, 3).map((name, index) => ({
    name,
    description: `Fallback local option for ${roleLabels[recommendation.role]} slot ${slot}.`,
    winRate: Math.max(48, recommendation.winRate - 0.6 + index * 0.4),
    matches: Math.max(1200, Math.round(recommendation.gamesCount * (0.38 - index * 0.08))),
  }));
}

const fallbackItemOptionPool: Record<Role, Record<4 | 5 | 6, string[]>> = {
  top: {
    4: ["Sterak's Gage", "Death's Dance", "Stridebreaker"],
    5: ["Spirit Visage", "Randuin's Omen", "Guardian Angel"],
    6: ["Force of Nature", "Thornmail", "Jak'Sho, The Protean"],
  },
  jungle: {
    4: ["Black Cleaver", "Serylda's Grudge", "Maw of Malmortius"],
    5: ["Guardian Angel", "Death's Dance", "Edge of Night"],
    6: ["Spirit Visage", "Frozen Heart", "Randuin's Omen"],
  },
  middle: {
    4: ["Shadowflame", "Rabadon's Deathcap", "Stormsurge"],
    5: ["Void Staff", "Zhonya's Hourglass", "Banshee's Veil"],
    6: ["Cryptbloom", "Liandry's Torment", "Cosmic Drive"],
  },
  bottom: {
    4: ["Lord Dominik's Regards", "Rapid Firecannon", "Runaan's Hurricane"],
    5: ["Bloodthirster", "Guardian Angel", "Mercurial Scimitar"],
    6: ["Mortal Reminder", "Immortal Shieldbow", "Yun Tal Wildarrows"],
  },
  utility: {
    4: ["Redemption", "Mikael's Blessing", "Shurelya's Battlesong"],
    5: ["Locket of the Iron Solari", "Knight's Vow", "Ardent Censer"],
    6: ["Staff of Flowing Water", "Dawncore", "Zeke's Convergence"],
  },
};

function buildMatchupAnalyticsIndex(entries: MatchupAnalyticsEntry[]) {
  return new Map(entries.map((entry) => [buildItemAnalyticsKey(entry.champion, entry.role), entry] as const));
}

function resolveMatchupAnalytics(
  recommendationsList: Recommendation[],
  champion: string,
  role: Role,
  backendMatchups: BackendMatchupsResponse | null,
  staticData: RiotStaticData | null,
): ReturnType<typeof buildMatchupAnalytics> {
  if (backendMatchups && hasBackendMatchups(backendMatchups)) {
    return {
      toughestMatchups: mapBackendMatchupEntries(backendMatchups.toughestMatchups, role, staticData),
      bestPicks: mapBackendMatchupEntries(backendMatchups.bestMatchups, role, staticData),
      worstPicks: [],
    };
  }

  const fallback = matchupAnalyticsIndex.get(buildItemAnalyticsKey(champion, role));
  if (fallback) {
    return {
      toughestMatchups: fallback.toughestMatchups,
      bestPicks: fallback.bestPicks,
      worstPicks: fallback.worstPicks,
    };
  }

  return buildMatchupAnalytics(recommendationsList, champion, role);
}

function buildBackendItemAnalytics(
  backendItems: BackendItemsResponse,
  items: Record<string, ItemStaticData> | null,
) {
  return {
    coreItems: resolveBackendCoreItems(
      backendItems.coreItems
        .sort((left, right) => right.gamesCount - left.gamesCount)
        .at(0)?.itemIds ?? [],
      items,
    ),
    fourthItemOptions: backendItems.fourthItemOptions.map((item, index) =>
      resolveBackendItemOption(item, items, `backend-fourth-${index}`),
    ),
    fifthItemOptions: backendItems.fifthItemOptions.map((item, index) =>
      resolveBackendItemOption(item, items, `backend-fifth-${index}`),
    ),
    sixthItemOptions: backendItems.sixthItemOptions.map((item, index) =>
      resolveBackendItemOption(item, items, `backend-sixth-${index}`),
    ),
  };
}

function resolveBackendCoreItems(itemIds: number[], items: Record<string, ItemStaticData> | null) {
  return itemIds.map((itemId, index) => {
    const item = items?.[String(itemId)] ?? null;
    return {
      id: String(itemId || `backend-core-${index}`),
      name: item?.name ?? `Item ${itemId}`,
      iconUrl: item?.iconUrl ?? null,
      description: item?.plaintext || item?.description || "Backend core item path.",
    };
  });
}

function resolveBackendItemOption(
  option: BackendItemOptionDto,
  items: Record<string, ItemStaticData> | null,
  fallbackId: string,
) {
  const representativeItemId = option.itemIds.at(-1) ?? option.itemIds[0] ?? 0;
  const item = representativeItemId ? items?.[String(representativeItemId)] ?? null : null;
  return {
    id: String(representativeItemId || fallbackId),
    name: item?.name ?? `Item ${representativeItemId || fallbackId}`,
    iconUrl: item?.iconUrl ?? null,
    description: `Patch ${option.patch}`,
    winRate: option.winRate,
    matches: option.gamesCount,
  };
}

function mapBackendMatchupEntries(
  entries: BackendMatchupEntryDto[],
  role: Role,
  staticData: RiotStaticData | null,
): AnalyticsEntry[] {
  return entries.map((entry) => ({
    champion:
      staticData?.champions.find((champion) => champion.key === entry.opponentChampionId)?.name ??
      `Champion ${entry.opponentChampionId}`,
    role,
    winRate: entry.winRate,
    pickRate: 0,
    gamesCount: entry.gamesCount,
    label: entry.difficulty,
  }));
}

function hasBackendItems(response: BackendItemsResponse | null): response is BackendItemsResponse {
  if (!response) {
    return false;
  }

  return [
    response.startingItems,
    response.coreItems,
    response.fourthItemOptions,
    response.fifthItemOptions,
    response.sixthItemOptions,
  ].some((section) => section.length > 0);
}

function hasBackendMatchups(response: BackendMatchupsResponse | null): response is BackendMatchupsResponse {
  if (!response) {
    return false;
  }

  return (
    response.toughestMatchups.length > 0 ||
    response.bestMatchups.length > 0
  );
}

function mergeBackendRecommendations(
  championId: number,
  championName: string,
  role: Role,
  backendRecommendations: BackendRecommendationDto[],
  localRecommendations: Recommendation[],
  staticData: RiotStaticData | null,
): Recommendation[] {
  if (backendRecommendations.length === 0) {
    return [];
  }

  const defaultFallback = localRecommendations[0] ?? null;

  return backendRecommendations.map((entry, index) => {
    const fallback =
      localRecommendations.find((item) => item.patch === entry.patch) ??
      localRecommendations[index] ??
      defaultFallback;

    const primaryStyleId = entry.primaryStyleId;
    const primaryStyle =
      primaryStyleId !== null
        ? staticData?.perkStyles.find((style) => style.id === primaryStyleId)?.name ?? fallback?.primaryStyle ?? "Adaptive"
        : fallback?.primaryStyle ?? "Adaptive";
    const subStyle =
      staticData?.perkStyles.find((style) => style.id === entry.subStyleId)?.name ??
      fallback?.subStyle ??
      "Secondary";

    return {
      buildId: `backend:${championId}:${role}:${entry.patch}:${index}`,
      label: `Riot API ${index + 1}`,
      championId,
      champion: championName,
      role: entry.role,
      fallback: false,
      primaryStyle,
      subStyle,
      selectedPerkIds: entry.selectedPerkIds.length > 0 ? entry.selectedPerkIds : fallback?.selectedPerkIds ?? [],
      summonerSpellIds: toSummonerSpellPair(entry.summonerSpellIds, fallback?.summonerSpellIds ?? [4, 14]),
      winRate: entry.winRate,
      pickRate: fallback?.pickRate ?? 0,
      gamesCount: entry.gamesCount,
      patch: entry.patch,
      source: "riot-api",
    };
  });
}

function toSummonerSpellPair(spellIds: number[], fallback: [number, number]): [number, number] {
  if (spellIds.length >= 2 && Number.isInteger(spellIds[0]) && Number.isInteger(spellIds[1])) {
    return [spellIds[0]!, spellIds[1]!] as [number, number];
  }

  return fallback;
}

async function fetchBackendJson<T>(
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
    retries?: number;
  },
): Promise<T> {
  if (!backendUrl) {
    throw new Error("Backend URL is not configured.");
  }

  const retries = options?.retries ?? 0;
  const timeoutMs = options?.timeoutMs ?? 5_000;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${backendUrl}${path}`, {
        method: options?.method ?? "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          ...(options?.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Backend request failed (${response.status}): ${body || path}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof DOMException && error.name === "AbortError"
        ? new Error(`Backend request timed out after ${timeoutMs}ms: ${path}`)
        : error;

      if (attempt >= retries) {
        break;
      }

      await sleep(250 * (attempt + 1));
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(formatError(lastError));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeBackendUrl(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    return "";
  }

  return trimmed.replace(/\/+$/, "");
}

function mapFrontendRoleToBackendRole(role: Role): Role {
  const mapping: Record<Role, Role> = {
    top: "top",
    jungle: "jungle",
    middle: "middle",
    bottom: "bottom",
    utility: "utility",
  };

  return mapping[role];
}

function resolveFrontendBackendUrl(): string {
  const configuredUrl = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL);
  if (configuredUrl) {
    return configuredUrl;
  }

  if (import.meta.env.DEV) {
    return "http://127.0.0.1:8787";
  }

  return "";
}

function isSameBackendStatus(a: BackendStatus, b: BackendStatus): boolean {
  return (
    a.state === b.state &&
    a.url === b.url &&
    a.healthUrl === b.healthUrl &&
    a.message === b.message &&
    a.lastHealthResponse === b.lastHealthResponse &&
    a.lastHealthError === b.lastHealthError
  );
}

function formatError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("pl-PL");
}
