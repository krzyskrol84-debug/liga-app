import { getLeagueClientConnectionInfo, type FindLeagueLockfileOptions } from "../league/lockfile.js";
import { LeagueClientApi } from "../league/lcuClient.js";
import { getChampionByKey } from "../riot/dataDragon.js";
import { buildSelectionKey, type AppSettings, type BuildRecommendation, type ChampionSelectState } from "../models/appModels.js";
import { RecommendationProvider, type RecommendationResult } from "../recommendations/RecommendationProvider.js";
import { GameflowService } from "./GameflowService.js";
import { PatchManager } from "./PatchManager.js";
import { AutoAcceptService } from "./AutoAcceptService.js";
import { AutoRunesService } from "./AutoRunesService.js";
import { AutoSummonersService } from "./AutoSummonersService.js";
import { AutoBanService } from "./AutoBanService.js";
import { AutoPickService } from "./AutoPickService.js";

export type PollingLoopStatus = {
  leagueClient: "connected" | "not-running" | "error";
  gameflowPhase: string | null;
  championSelect: ChampionSelectState | null;
  recommendation: BuildRecommendation | null;
  patch: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type PollingLoopOptions = {
  intervalMs?: number;
  lockfile?: FindLeagueLockfileOptions;
  settings: () => AppSettings | Promise<AppSettings>;
  onStatus?: (status: PollingLoopStatus) => void;
  onLog?: (event: { level: "info" | "warn" | "error"; message: string; details?: unknown }) => void;
};

export class PollingLoopService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lcu: LeagueClientApi | null = null;
  private services: RuntimeServices | null = null;
  private readonly intervalMs: number;
  private status: PollingLoopStatus = emptyStatus();
  private currentChampSelectSessionKey: string | null = null;

  constructor(
    private readonly patchManager: PatchManager,
    private readonly recommendations: RecommendationProvider,
    private readonly options: PollingLoopOptions,
  ) {
    this.intervalMs = Math.max(2_000, options.intervalMs ?? 3_000);
  }

  start(): void {
    if (this.timer) return;
    this.scheduleNextTick(0);
  }

  stop(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  getStatus(): PollingLoopStatus {
    return this.status;
  }

  async tick(): Promise<PollingLoopStatus> {
    if (this.running) return this.status;
    this.running = true;
    let nextDelayMs = this.intervalMs;

    try {
      const settings = await this.options.settings();
      const lcu = await this.getLcu();
      const runtime = this.getRuntimeServices(lcu);
      const phase = await runtime.gameflow.getPhase();
      this.log("info", "gameflowPhase tick", { gameflowPhase: phase });
      const patchData = await this.patchManager.loadCurrentData();
      let championSelect: ChampionSelectState | null = null;
      let recommendation: BuildRecommendation | null = null;

      if (phase === "ReadyCheck") {
        nextDelayMs = 400;
        await this.tryAction("auto accept", () => runtime.autoAccept.run(settings.autoAccept));
      } else {
        runtime.autoAccept.reset();
      }

      if (phase === "ChampSelect") {
        championSelect = await runtime.gameflow.getChampionSelectState();
        const sessionKey = buildChampSelectSessionKey(championSelect);
        if (sessionKey !== this.currentChampSelectSessionKey) {
          runtime.autoBan.reset();
          runtime.autoPick.reset();
          this.currentChampSelectSessionKey = sessionKey;
          this.log("info", "champ select session reset", { sessionKey });
        }

        if (championSelect.active && championSelect.championId && championSelect.assignedPosition) {
          const found = getChampionByKey(patchData, championSelect.championId);
          const selectedBuildId =
            settings.selectedBuilds[buildSelectionKey(championSelect.championId, championSelect.assignedPosition)] ??
            null;
          const rec = await resolveSelectedRecommendation(
            this.recommendations,
            championSelect.championId,
            championSelect.assignedPosition,
            selectedBuildId,
          );
          recommendation = toBuildRecommendation(rec, championSelect.championId, found?.name ?? rec.champion);

          await this.tryAction("auto runes", () => runtime.autoRunes.apply(recommendation!, settings.autoRunes));
          await this.tryAction("auto summoners", () =>
            runtime.autoSummoners.apply(recommendation!, settings.autoSummoners),
          );
        }

        await this.tryAction("auto ban", () => runtime.autoBan.run(settings.autoBan));
        await this.tryAction("auto pick", () => runtime.autoPick.run(settings.autoPick));
      } else {
        if (this.currentChampSelectSessionKey !== null) {
          runtime.autoBan.reset();
          runtime.autoPick.reset();
          this.currentChampSelectSessionKey = null;
        }
      }

      this.setStatus({
        leagueClient: "connected",
        gameflowPhase: phase,
        championSelect,
        recommendation,
        patch: patchData.version,
        lastError: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const leagueClient = message.toLowerCase().includes("lockfile") ? "not-running" : "error";
      this.setStatus({ ...this.status, leagueClient, lastError: message, updatedAt: new Date().toISOString() });
      this.log("error", "Polling loop failed.", { message });
      this.lcu = null;
      this.services = null;
    } finally {
      this.running = false;
      if (this.timer) {
        this.scheduleNextTick(nextDelayMs);
      }
    }

    return this.status;
  }

  private async getLcu(): Promise<LeagueClientApi> {
    if (this.lcu) return this.lcu;
    const connection = await getLeagueClientConnectionInfo(this.options.lockfile);
    this.lcu = LeagueClientApi.fromLockfile(connection);
    return this.lcu;
  }

  private getRuntimeServices(lcu: LeagueClientApi): RuntimeServices {
    if (this.services) return this.services;
    this.services = {
      gameflow: new GameflowService(lcu),
      autoAccept: new AutoAcceptService(lcu),
      autoRunes: new AutoRunesService(lcu),
      autoSummoners: new AutoSummonersService(lcu),
      autoBan: new AutoBanService(lcu),
      autoPick: new AutoPickService(lcu),
    };
    return this.services;
  }

  private async tryAction(name: string, action: () => Promise<unknown>): Promise<void> {
    try {
      const result = await action();
      if (isSkippedActionResult(result)) {
        if (result.reason === "disabled" || result.reason === "confirmation_required" || result.reason === "cooldown") {
          return;
        }
        this.log("warn", `${name} skipped.`, result);
        return;
      }
      this.log("info", `${name} completed.`, result);
    } catch (error) {
      if (error instanceof Error) {
        this.log("error", `${name} failed.`, {
          message: error.message,
          name: error.name,
          ...(typeof error === "object" && error !== null ? error : {}),
        });
        return;
      }
      this.log("error", `${name} failed.`, error);
    }
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private setStatus(status: PollingLoopStatus): void {
    const shouldNotify = !isSameStatus(this.status, status);
    this.status = shouldNotify ? status : { ...this.status, updatedAt: status.updatedAt };
    if (shouldNotify) {
      this.options.onStatus?.(this.status);
    }
  }

  private log(level: "info" | "warn" | "error", message: string, details?: unknown): void {
    this.options.onLog?.({ level, message, details });
  }
}

type RuntimeServices = {
  gameflow: GameflowService;
  autoAccept: AutoAcceptService;
  autoRunes: AutoRunesService;
  autoSummoners: AutoSummonersService;
  autoBan: AutoBanService;
  autoPick: AutoPickService;
};

function buildChampSelectSessionKey(state: ChampionSelectState | null): string | null {
  if (!state?.active) {
    return null;
  }
  return [
    state.summonerId ?? "none",
    state.assignedPosition ?? "none",
    state.banActionId ?? "none",
    state.pickActionId ?? "none",
  ].join(":");
}

function toBuildRecommendation(
  result: RecommendationResult,
  championId: number,
  championName: string,
): BuildRecommendation {
  return {
    buildId: result.buildId,
    label: result.label,
    championId,
    championName,
    role: result.matchedRole,
    primaryStyleId: result.runes.primaryStyleId ?? 0,
    subStyleId: result.runes.subStyleId ?? 0,
    selectedPerkIds: result.runes.selectedPerkIds,
    summonerSpellIds: result.summonerSpells.ids,
    winRate: result.stats.winRate,
    pickRate: result.stats.pickRate,
    gamesCount: result.stats.gamesCount,
    patch: result.patch,
    source: result.source,
  };
}

async function resolveSelectedRecommendation(
  provider: RecommendationProvider,
  championId: number,
  role: ChampionSelectState["assignedPosition"],
  selectedBuildId: string | null,
): Promise<RecommendationResult> {
  const recommendations = await provider.getRecommendations(championId, role ?? "middle");

  if (selectedBuildId) {
    const selected = recommendations.find((entry) => entry.buildId === selectedBuildId);
    if (selected) {
      return selected;
    }
  }

  return recommendations[0];
}

function emptyStatus(): PollingLoopStatus {
  return {
    leagueClient: "not-running",
    gameflowPhase: null,
    championSelect: null,
    recommendation: null,
    patch: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
}

function isSameStatus(a: PollingLoopStatus, b: PollingLoopStatus): boolean {
  return JSON.stringify({
    leagueClient: a.leagueClient,
    gameflowPhase: a.gameflowPhase,
    championSelect: a.championSelect,
    recommendation: a.recommendation,
    patch: a.patch,
    lastError: a.lastError,
  }) === JSON.stringify({
    leagueClient: b.leagueClient,
    gameflowPhase: b.gameflowPhase,
    championSelect: b.championSelect,
    recommendation: b.recommendation,
    patch: b.patch,
    lastError: b.lastError,
  });
}

function isSkippedActionResult(value: unknown): value is { skipped: true; reason: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "skipped" in value &&
    (value as { skipped?: unknown }).skipped === true &&
    "reason" in value &&
    typeof (value as { reason?: unknown }).reason === "string"
  );
}
