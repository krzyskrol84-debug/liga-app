import { getChampionSelectSession, getCurrentGameflowPhase, type LcuChampSelectAction } from "../league/champSelect.js";
import { LeagueClientApi, LeagueClientApiError } from "../league/lcuClient.js";
import type { AutoPickSettings } from "../models/appModels.js";

export class AutoPickService {
  private executedActionIds = new Set<number>();
  private attemptedActionChampionKeys = new Set<string>();

  constructor(private readonly lcu: LeagueClientApi) {}

  async run(settings: AutoPickSettings) {
    if (!settings.enabled) return { skipped: true, reason: "disabled" };

    const gameflowPhase = await getCurrentGameflowPhase(this.lcu);
    if (gameflowPhase !== "ChampSelect") {
      return { skipped: true, reason: "not_champ_select", gameflowPhase };
    }

    const session = await getChampionSelectSession(this.lcu);
    const action = findLocalPickAction(session);
    if (!action) {
      return {
        skipped: true,
        reason: "pick_action_not_found",
        gameflowPhase,
        localPlayerCellId: session.localPlayerCellId,
      };
    }

    if (this.executedActionIds.has(action.id)) {
      return { skipped: true, reason: "already_executed", actionId: action.id, gameflowPhase };
    }

    const unavailable = new Set<number>([
      ...(session.bans?.myTeamBans ?? []),
      ...(session.bans?.theirTeamBans ?? []),
      ...session.myTeam.map((player) => player.championId).filter((championId) => championId > 0),
      ...session.theirTeam.map((player) => player.championId).filter((championId) => championId > 0),
    ]);
    const candidates = [settings.preferredPickChampionId, ...settings.backupPickChampionIds].filter(
      (id): id is number => isPositiveInteger(id) && !unavailable.has(id),
    );
    const attempts: Array<{ actionId: number; championId: number; status: number | null; body: unknown | null }> = [];

    for (const championId of candidates) {
      const attemptKey = `${action.id}:${championId}:${settings.confirmPick}`;
      if (this.attemptedActionChampionKeys.has(attemptKey)) {
        continue;
      }

      try {
        this.attemptedActionChampionKeys.add(attemptKey);
        await this.lcu.patch<void, { championId: number; completed: boolean }>(
          `/lol-champ-select/v1/session/actions/${action.id}`,
          { championId, completed: settings.confirmPick },
        );
        if (settings.confirmPick) {
          this.executedActionIds.add(action.id);
        }
        return {
          actionId: action.id,
          championId,
          completed: settings.confirmPick,
          localPlayerCellId: session.localPlayerCellId,
          gameflowPhase,
          endpoint: `/lol-champ-select/v1/session/actions/${action.id}`,
          attempts,
          log: "pick action found/error",
        };
      } catch (error) {
        if (error instanceof LeagueClientApiError) {
          attempts.push({
            actionId: action.id,
            championId,
            status: error.status ?? null,
            body: error.responseBody ?? null,
          });
          continue;
        }
        throw error;
      }
    }

    return {
      skipped: true,
      reason: "no_available_candidate",
      actionId: action.id,
      localPlayerCellId: session.localPlayerCellId,
      gameflowPhase,
      attempts,
    };
  }

  reset(): void {
    this.executedActionIds.clear();
    this.attemptedActionChampionKeys.clear();
  }
}

function findLocalPickAction(
  session: Awaited<ReturnType<typeof getChampionSelectSession>>,
): LcuChampSelectAction | null {
  return (
    session.actions
      .flat()
      .find(
        (action) =>
          action.actorCellId === session.localPlayerCellId &&
          action.type === "pick" &&
          (action.isInProgress || !action.completed) &&
          !action.completed,
      ) ?? null
  );
}

function isPositiveInteger(id: number | null): id is number {
  return id !== null && Number.isInteger(id) && id > 0;
}
