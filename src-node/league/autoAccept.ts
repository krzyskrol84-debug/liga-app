import type { LeagueClientApi } from "./lcuClient.js";
import { getCurrentGameflowPhase } from "./champSelect.js";

export type ReadyCheckState = "Invalid" | "InProgress" | "EveryoneReady" | "StrangerNotReady" | string;
export type ReadyCheckPlayerResponse = "None" | "Accepted" | "Declined" | string;

export type LcuReadyCheck = {
  state: ReadyCheckState;
  playerResponse: ReadyCheckPlayerResponse;
  timer: number;
};

export type AutoAcceptResult = {
  accepted: boolean;
  gameflowPhase: string;
  state?: ReadyCheckState;
  playerResponse?: ReadyCheckPlayerResponse;
};

export class AutoAcceptError extends Error {
  readonly code: "NOT_READY_CHECK" | "READY_CHECK_READ_FAILED" | "ACCEPT_FAILED";
  readonly details?: unknown;

  constructor(code: AutoAcceptError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "AutoAcceptError";
    this.code = code;
    this.details = details;
  }
}

export async function autoAcceptReadyCheck(lcu: LeagueClientApi): Promise<AutoAcceptResult> {
  const gameflowPhase = await getCurrentGameflowPhase(lcu);

  if (gameflowPhase !== "ReadyCheck") {
    return {
      accepted: false,
      gameflowPhase,
    };
  }

  const readyCheck = await getReadyCheck(lcu);

  if (readyCheck.playerResponse === "Accepted" || readyCheck.state !== "InProgress") {
    return {
      accepted: false,
      gameflowPhase,
      state: readyCheck.state,
      playerResponse: readyCheck.playerResponse,
    };
  }

  try {
    await lcu.post<void>("/lol-matchmaking/v1/ready-check/accept");
  } catch (error) {
    throw new AutoAcceptError("ACCEPT_FAILED", "League Client rejected ready check accept.", {
      cause: formatUnknownError(error),
    });
  }

  return {
    accepted: true,
    gameflowPhase,
    state: readyCheck.state,
    playerResponse: "Accepted",
  };
}

export async function getReadyCheck(lcu: LeagueClientApi): Promise<LcuReadyCheck> {
  try {
    return await lcu.get<LcuReadyCheck>("/lol-matchmaking/v1/ready-check");
  } catch (error) {
    throw new AutoAcceptError("READY_CHECK_READ_FAILED", "Could not read ready check state.", {
      cause: formatUnknownError(error),
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
