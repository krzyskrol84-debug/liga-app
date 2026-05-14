import { detectChampionSelect, getCurrentGameflowPhase, type LeagueAssignedPosition } from "./champSelect.js";
import { LeagueClientApi } from "./lcuClient.js";
import {
  getLeagueClientConnectionInfo,
  type FindLeagueLockfileOptions,
  type LeagueClientConnectionInfo,
  LeagueLockfileError,
} from "./lockfile.js";
import {
  DataDragonClient,
  getChampionByKey,
  type DataDragonCacheOptions,
  type DataDragonData,
} from "../riot/dataDragon.js";
import {
  RecommendationProvider,
  type RecommendationProviderOptions,
  type RecommendationResult,
} from "../recommendations/RecommendationProvider.js";
import { isChampionRole, type ChampionRole } from "../models/domain.js";

export type LeaguePollingStatus =
  | "idle"
  | "league_client_missing"
  | "league_client_connected"
  | "champ_select"
  | "error";

export type LeaguePollingState = {
  status: LeaguePollingStatus;
  checkedAt: string;
  leagueClientConnected: boolean;
  lockfilePath: string | null;
  gameflowPhase: string | null;
  isInChampionSelect: boolean;
  championId: number | null;
  championName: string | null;
  assignedPosition: LeagueAssignedPosition | null;
  recommendationRole: ChampionRole | null;
  summonerId: number | null;
  recommendation: RecommendationResult | null;
  lastError: PollingErrorInfo | null;
};

export type PollingErrorInfo = {
  name: string;
  message: string;
  code?: string;
};

export type LeaguePollingOptions = {
  intervalMs?: number;
  lockfile?: FindLeagueLockfileOptions;
  dataDragon?: DataDragonCacheOptions;
  recommendations?: RecommendationProviderOptions;
  fallbackRole?: ChampionRole;
  onState?: (state: LeaguePollingState) => void;
  onError?: (error: unknown, state: LeaguePollingState) => void;
};

const DEFAULT_INTERVAL_MS = 3000;

export class LeagueChampionSelectPoller {
  private readonly intervalMs: number;
  private readonly lockfileOptions: FindLeagueLockfileOptions;
  private readonly dataDragonClient: DataDragonClient;
  private readonly recommendationProvider: RecommendationProvider;
  private readonly fallbackRole?: ChampionRole;
  private readonly onState?: (state: LeaguePollingState) => void;
  private readonly onError?: (error: unknown, state: LeaguePollingState) => void;

  private timer: NodeJS.Timeout | null = null;
  private currentState: LeaguePollingState = createIdleState();
  private dataDragonPromise: Promise<DataDragonData> | null = null;
  private isTickRunning = false;

  constructor(options: LeaguePollingOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.lockfileOptions = options.lockfile ?? {};
    this.dataDragonClient = new DataDragonClient(options.dataDragon);
    this.recommendationProvider = new RecommendationProvider(options.recommendations);
    this.fallbackRole = options.fallbackRole;
    this.onState = options.onState;
    this.onError = options.onError;
  }

  start({ immediate = true }: { immediate?: boolean } = {}): void {
    if (this.timer) {
      return;
    }

    if (immediate) {
      void this.tick();
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  getState(): LeaguePollingState {
    return this.currentState;
  }

  async pollOnce(): Promise<LeaguePollingState> {
    return this.tick();
  }

  private async tick(): Promise<LeaguePollingState> {
    if (this.isTickRunning) {
      return this.currentState;
    }

    this.isTickRunning = true;

    try {
      const state = await this.readState();
      this.setState(state);
      return state;
    } catch (error) {
      const state = createErrorState(this.currentState, error);
      this.setState(state);
      this.onError?.(error, state);
      return state;
    } finally {
      this.isTickRunning = false;
    }
  }

  private async readState(): Promise<LeaguePollingState> {
    const checkedAt = new Date().toISOString();
    let connectionInfo: LeagueClientConnectionInfo;

    try {
      connectionInfo = await getLeagueClientConnectionInfo(this.lockfileOptions);
    } catch (error) {
      if (error instanceof LeagueLockfileError && error.code === "LOCKFILE_NOT_FOUND") {
        return {
          ...createIdleState(),
          status: "league_client_missing",
          checkedAt,
          lastError: toPollingErrorInfo(error),
        };
      }

      throw error;
    }

    const lcu = LeagueClientApi.fromLockfile(connectionInfo);
    const detection = await detectChampionSelect(lcu);

    if (!detection.isInChampionSelect) {
      return {
        status: "league_client_connected",
        checkedAt,
        leagueClientConnected: true,
        lockfilePath: connectionInfo.lockfilePath,
        gameflowPhase: detection.gameflowPhase,
        isInChampionSelect: false,
        championId: null,
        championName: null,
        assignedPosition: null,
        recommendationRole: null,
        summonerId: null,
        recommendation: null,
        lastError: null,
      };
    }

    const dataDragon = await this.loadDataDragon();
    const champion = detection.championId > 0 ? getChampionByKey(dataDragon, detection.championId) : undefined;
    const championName = champion?.name ?? null;
    const recommendationRole = resolveRecommendationRole(detection.assignedPosition, this.fallbackRole);
    const recommendation =
      championName && recommendationRole
        ? await this.recommendationProvider.getRecommendation(championName, recommendationRole)
        : null;

    return {
      status: "champ_select",
      checkedAt,
      leagueClientConnected: true,
      lockfilePath: connectionInfo.lockfilePath,
      gameflowPhase: "ChampSelect",
      isInChampionSelect: true,
      championId: detection.championId > 0 ? detection.championId : null,
      championName,
      assignedPosition: detection.assignedPosition,
      recommendationRole,
      summonerId: detection.summonerId,
      recommendation,
      lastError: null,
    };
  }

  private loadDataDragon(): Promise<DataDragonData> {
    this.dataDragonPromise ??= this.dataDragonClient.load();
    return this.dataDragonPromise;
  }

  private setState(state: LeaguePollingState): void {
    this.currentState = state;
    this.onState?.(state);
  }
}

export function createLeagueChampionSelectPoller(options?: LeaguePollingOptions): LeagueChampionSelectPoller {
  return new LeagueChampionSelectPoller(options);
}

export async function pollLeagueChampionSelectOnce(options?: LeaguePollingOptions): Promise<LeaguePollingState> {
  return new LeagueChampionSelectPoller(options).pollOnce();
}

export async function isLeagueClientReachable(options?: FindLeagueLockfileOptions): Promise<boolean> {
  try {
    const connectionInfo = await getLeagueClientConnectionInfo(options);
    const lcu = LeagueClientApi.fromLockfile(connectionInfo);
    await getCurrentGameflowPhase(lcu);
    return true;
  } catch {
    return false;
  }
}

function resolveRecommendationRole(
  assignedPosition: LeagueAssignedPosition,
  fallbackRole?: ChampionRole,
): ChampionRole | null {
  if (assignedPosition && isChampionRole(assignedPosition)) {
    return assignedPosition;
  }

  return fallbackRole ?? null;
}

function createIdleState(): LeaguePollingState {
  return {
    status: "idle",
    checkedAt: new Date().toISOString(),
    leagueClientConnected: false,
    lockfilePath: null,
    gameflowPhase: null,
    isInChampionSelect: false,
    championId: null,
    championName: null,
    assignedPosition: null,
    recommendationRole: null,
    summonerId: null,
    recommendation: null,
    lastError: null,
  };
}

function createErrorState(previousState: LeaguePollingState, error: unknown): LeaguePollingState {
  return {
    ...previousState,
    status: "error",
    checkedAt: new Date().toISOString(),
    lastError: toPollingErrorInfo(error),
  };
}

function toPollingErrorInfo(error: unknown): PollingErrorInfo {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string };

    return {
      name: error.name,
      message: error.message,
      code: errorWithCode.code,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}
