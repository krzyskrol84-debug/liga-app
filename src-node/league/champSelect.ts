import type { LeagueClientApi } from "./lcuClient.js";

export type LeagueGameflowPhase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
  | "GameStart"
  | "InProgress"
  | "WaitingForStats"
  | "PreEndOfGame"
  | "EndOfGame"
  | "Reconnect"
  | string;

export type LeagueAssignedPosition = "top" | "jungle" | "middle" | "bottom" | "utility" | "";

export type LcuChampSelectPlayer = {
  assignedPosition: LeagueAssignedPosition;
  cellId: number;
  championId: number;
  championPickIntent: number;
  nameVisibilityType?: string;
  obfuscatedPuuid?: string;
  obfuscatedSummonerId?: number;
  puuid?: string;
  selectedSkinId: number;
  spell1Id: number;
  spell2Id: number;
  summonerId: number;
  team: number;
  wardSkinId?: number;
};

export type LcuChampSelectAction = {
  actorCellId: number;
  championId: number;
  completed: boolean;
  id: number;
  isAllyAction: boolean;
  isInProgress: boolean;
  pickTurn: number;
  type: "pick" | "ban" | string;
};

export type LcuChampSelectSession = {
  actions: LcuChampSelectAction[][];
  allowBattleBoost?: boolean;
  allowDuplicatePicks?: boolean;
  allowLockedEvents?: boolean;
  allowRerolling?: boolean;
  allowSkinSelection?: boolean;
  bans?: {
    myTeamBans: number[];
    numBans: number;
    theirTeamBans: number[];
  };
  benchChampions?: unknown[];
  counter?: number;
  hasSimultaneousBans?: boolean;
  hasSimultaneousPicks?: boolean;
  isCustomGame?: boolean;
  isSpectating?: boolean;
  localPlayerCellId: number;
  lockedEventIndex?: number;
  myTeam: LcuChampSelectPlayer[];
  recoveryCounter?: number;
  rerollsRemaining?: number;
  skipChampionSelect?: boolean;
  theirTeam: LcuChampSelectPlayer[];
  timer?: {
    adjustedTimeLeftInPhase: number;
    internalNowInEpochMs: number;
    isInfinite: boolean;
    phase: string;
    totalTimeInPhase: number;
  };
  trades?: unknown[];
};

export type ChampionSelectDetection =
  | {
      isInChampionSelect: false;
      gameflowPhase: LeagueGameflowPhase;
      session: null;
      championId: null;
      assignedPosition: null;
      summonerId: null;
      localPlayerCellId: null;
    }
  | {
      isInChampionSelect: true;
      gameflowPhase: "ChampSelect";
      session: LcuChampSelectSession;
      championId: number;
      assignedPosition: LeagueAssignedPosition;
      summonerId: number;
      localPlayerCellId: number;
    };

export class ChampionSelectDetectionError extends Error {
  readonly code:
    | "GAMEFLOW_READ_FAILED"
    | "SESSION_READ_FAILED"
    | "LOCAL_PLAYER_NOT_FOUND"
    | "INVALID_CHAMP_SELECT_SESSION";
  readonly details?: unknown;

  constructor(code: ChampionSelectDetectionError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "ChampionSelectDetectionError";
    this.code = code;
    this.details = details;
  }
}

export async function detectChampionSelect(lcu: LeagueClientApi): Promise<ChampionSelectDetection> {
  const gameflowPhase = await getCurrentGameflowPhase(lcu);

  if (gameflowPhase !== "ChampSelect") {
    return {
      isInChampionSelect: false,
      gameflowPhase,
      session: null,
      championId: null,
      assignedPosition: null,
      summonerId: null,
      localPlayerCellId: null,
    };
  }

  const session = await getChampionSelectSession(lcu);
  const localPlayer = getLocalChampSelectPlayer(session);

  return {
    isInChampionSelect: true,
    gameflowPhase: "ChampSelect",
    session,
    championId: localPlayer.championId,
    assignedPosition: localPlayer.assignedPosition,
    summonerId: localPlayer.summonerId,
    localPlayerCellId: session.localPlayerCellId,
  };
}

export async function getCurrentGameflowPhase(lcu: LeagueClientApi): Promise<LeagueGameflowPhase> {
  try {
    return await lcu.get<LeagueGameflowPhase>("/lol-gameflow/v1/gameflow-phase");
  } catch (error) {
    throw new ChampionSelectDetectionError(
      "GAMEFLOW_READ_FAILED",
      "Could not read current League Client gameflow phase.",
      { cause: formatUnknownError(error) },
    );
  }
}

export async function getChampionSelectSession(lcu: LeagueClientApi): Promise<LcuChampSelectSession> {
  let session: LcuChampSelectSession;

  try {
    session = await lcu.get<LcuChampSelectSession>("/lol-champ-select/v1/session");
  } catch (error) {
    throw new ChampionSelectDetectionError(
      "SESSION_READ_FAILED",
      "Could not read League Client champion select session.",
      { cause: formatUnknownError(error) },
    );
  }

  validateChampSelectSession(session);
  return session;
}

export function getLocalChampSelectPlayer(session: LcuChampSelectSession): LcuChampSelectPlayer {
  const localPlayer = session.myTeam.find((player) => player.cellId === session.localPlayerCellId);

  if (!localPlayer) {
    throw new ChampionSelectDetectionError(
      "LOCAL_PLAYER_NOT_FOUND",
      "Could not find local player in champion select session myTeam array.",
      {
        localPlayerCellId: session.localPlayerCellId,
        myTeamCellIds: session.myTeam.map((player) => player.cellId),
      },
    );
  }

  return localPlayer;
}

export function isChampionPicked(detection: ChampionSelectDetection): boolean {
  return detection.isInChampionSelect && detection.championId > 0;
}

export function hasAssignedPosition(detection: ChampionSelectDetection): boolean {
  return detection.isInChampionSelect && detection.assignedPosition !== "";
}

function validateChampSelectSession(session: LcuChampSelectSession): void {
  if (!Number.isInteger(session.localPlayerCellId)) {
    throw new ChampionSelectDetectionError(
      "INVALID_CHAMP_SELECT_SESSION",
      "Champion select session has invalid localPlayerCellId.",
      { localPlayerCellId: session.localPlayerCellId },
    );
  }

  if (!Array.isArray(session.myTeam)) {
    throw new ChampionSelectDetectionError(
      "INVALID_CHAMP_SELECT_SESSION",
      "Champion select session has invalid myTeam array.",
      { myTeam: session.myTeam },
    );
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
