import {
  getChampionSelectSession,
  getCurrentGameflowPhase,
  type LcuChampSelectAction,
  type LcuChampSelectSession,
} from "./champSelect.js";
import type { LeagueClientApi } from "./lcuClient.js";

export type ChampSelectActionType = "pick" | "ban";

export type ChampSelectActionRequest = {
  championId: number;
  completed?: boolean;
};

export type ChampSelectActionResult = {
  actionId: number;
  actionType: ChampSelectActionType;
  championId: number;
  completed: boolean;
};

export class PickBanError extends Error {
  readonly code:
    | "NOT_IN_CHAMP_SELECT"
    | "INVALID_CHAMPION_ID"
    | "ACTION_NOT_AVAILABLE"
    | "ACTION_PATCH_FAILED"
    | "ACTION_COMPLETE_FAILED";
  readonly details?: unknown;

  constructor(code: PickBanError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "PickBanError";
    this.code = code;
    this.details = details;
  }
}

export async function autoPickChampion(
  lcu: LeagueClientApi,
  request: ChampSelectActionRequest,
): Promise<ChampSelectActionResult> {
  return applyChampSelectAction(lcu, "pick", request);
}

export async function autoBanChampion(
  lcu: LeagueClientApi,
  request: ChampSelectActionRequest,
): Promise<ChampSelectActionResult> {
  return applyChampSelectAction(lcu, "ban", request);
}

export async function applyChampSelectAction(
  lcu: LeagueClientApi,
  actionType: ChampSelectActionType,
  request: ChampSelectActionRequest,
): Promise<ChampSelectActionResult> {
  validateChampionId(request.championId);

  const gameflowPhase = await getCurrentGameflowPhase(lcu);

  if (gameflowPhase !== "ChampSelect") {
    throw new PickBanError("NOT_IN_CHAMP_SELECT", "Champion select is not active.", {
      gameflowPhase,
    });
  }

  const session = await getChampionSelectSession(lcu);
  const action = findLocalInProgressAction(session, actionType);

  if (!action) {
    throw new PickBanError("ACTION_NOT_AVAILABLE", `No local ${actionType} action is currently available.`, {
      localPlayerCellId: session.localPlayerCellId,
      actionType,
    });
  }

  try {
    await lcu.patch<void, { championId: number; completed?: boolean }>(
      `/lol-champ-select/v1/session/actions/${action.id}`,
      {
        championId: request.championId,
        completed: request.completed ?? false,
      },
    );
  } catch (error) {
    throw new PickBanError("ACTION_PATCH_FAILED", `Could not set ${actionType} champion.`, {
      actionId: action.id,
      championId: request.championId,
      cause: formatUnknownError(error),
    });
  }

  if (request.completed) {
    await completeChampSelectAction(lcu, action.id);
  }

  return {
    actionId: action.id,
    actionType,
    championId: request.championId,
    completed: request.completed ?? false,
  };
}

export async function completeChampSelectAction(lcu: LeagueClientApi, actionId: number): Promise<void> {
  try {
    await lcu.post<void>(`/lol-champ-select/v1/session/actions/${actionId}/complete`);
  } catch (error) {
    throw new PickBanError("ACTION_COMPLETE_FAILED", "Could not complete champion select action.", {
      actionId,
      cause: formatUnknownError(error),
    });
  }
}

export function findLocalInProgressAction(
  session: LcuChampSelectSession,
  actionType: ChampSelectActionType,
): LcuChampSelectAction | null {
  return (
    session.actions
      .flat()
      .find(
        (action) =>
          action.actorCellId === session.localPlayerCellId &&
          action.type === actionType &&
          action.isInProgress &&
          !action.completed,
      ) ?? null
  );
}

function validateChampionId(championId: number): void {
  if (!Number.isInteger(championId) || championId <= 0) {
    throw new PickBanError("INVALID_CHAMPION_ID", "championId must be a positive integer.", {
      championId,
    });
  }
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return String(error);
}
