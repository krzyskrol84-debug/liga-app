import { getChampionSelectSession, getCurrentGameflowPhase, type LcuChampSelectAction } from "../league/champSelect.js";
import { LeagueClientApi, LeagueClientApiError } from "../league/lcuClient.js";
import type { AutoBanSettings } from "../models/appModels.js";

export class AutoBanService {
  private executedActionIds = new Set<number>();
  private attemptedActionChampionKeys = new Set<string>();

  constructor(private readonly lcu: LeagueClientApi) {}

  async run(settings: AutoBanSettings) {
    if (!settings.enabled) return { skipped: true, reason: "disabled" };
    if (settings.confirmBeforeBan) return { skipped: true, reason: "confirmation_required" };

    const gameflowPhase = await getCurrentGameflowPhase(this.lcu);
    if (gameflowPhase !== "ChampSelect") {
      return { skipped: true, reason: "not_champ_select", gameflowPhase };
    }

    const session = await getChampionSelectSession(this.lcu);
    const action = findLocalBanAction(session);
    if (!action) {
      return {
        skipped: true,
        reason: "ban_action_not_found",
        gameflowPhase,
        localPlayerCellId: session.localPlayerCellId,
      };
    }

    if (this.executedActionIds.has(action.id)) {
      return { skipped: true, reason: "already_executed", actionId: action.id, gameflowPhase };
    }

    const banned = new Set([...(session.bans?.myTeamBans ?? []), ...(session.bans?.theirTeamBans ?? [])]);
    const candidates = [settings.preferredBanChampionId, settings.backupBanChampionId].filter(
      (id): id is number => isPositiveInteger(id) && !banned.has(id),
    );
    const attempts: Array<{ actionId: number; championId: number; status: number | null; body: unknown | null }> = [];

    for (const championId of candidates) {
      const attemptKey = `${action.id}:${championId}`;
      if (this.attemptedActionChampionKeys.has(attemptKey)) {
        continue;
      }

      try {
        this.attemptedActionChampionKeys.add(attemptKey);
        await this.lcu.patch<void, { championId: number; completed: true }>(
          `/lol-champ-select/v1/session/actions/${action.id}`,
          { championId, completed: true },
        );
        this.executedActionIds.add(action.id);
        return {
          actionId: action.id,
          championId,
          completed: true,
          localPlayerCellId: session.localPlayerCellId,
          gameflowPhase,
          endpoint: `/lol-champ-select/v1/session/actions/${action.id}`,
          attempts,
          log: "ban action found/error",
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

function findLocalBanAction(
  session: Awaited<ReturnType<typeof getChampionSelectSession>>,
): LcuChampSelectAction | null {
  return (
    session.actions
      .flat()
      .find(
        (action) =>
          action.actorCellId === session.localPlayerCellId &&
          action.type === "ban" &&
          (action.isInProgress || !action.completed) &&
          !action.completed,
      ) ?? null
  );
}

function isPositiveInteger(id: number | null): id is number {
  return id !== null && Number.isInteger(id) && id > 0;
}
