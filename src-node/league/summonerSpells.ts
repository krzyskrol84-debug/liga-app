import type { LeagueClientApi } from "./lcuClient.js";
import {
  getChampionSelectSession,
  getCurrentGameflowPhase,
  getLocalChampSelectPlayer,
  type LcuChampSelectPlayer,
} from "./champSelect.js";

export type SetSummonerSpellsInput = {
  spell1Id: number;
  spell2Id: number;
};

export type LcuChampSelectMySelectionPatch = {
  spell1Id: number;
  spell2Id: number;
};

export type SetSummonerSpellsResult = {
  spell1Id: number;
  spell2Id: number;
  previousSpell1Id: number;
  previousSpell2Id: number;
  summonerId: number;
  localPlayerCellId: number;
  applied: boolean;
};

export class SetSummonerSpellsError extends Error {
  readonly code:
    | "NOT_IN_CHAMP_SELECT"
    | "INVALID_SPELL_ID"
    | "SAME_SPELL"
    | "APPLY_FAILED"
    | "VERIFY_FAILED";
  readonly details?: unknown;

  constructor(code: SetSummonerSpellsError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "SetSummonerSpellsError";
    this.code = code;
    this.details = details;
  }
}

export async function setSummonerSpellsDuringChampionSelect(
  lcu: LeagueClientApi,
  input: SetSummonerSpellsInput,
): Promise<SetSummonerSpellsResult> {
  validateSummonerSpellIds(input.spell1Id, input.spell2Id);

  const gameflowPhase = await getCurrentGameflowPhase(lcu);

  if (gameflowPhase !== "ChampSelect") {
    throw new SetSummonerSpellsError(
      "NOT_IN_CHAMP_SELECT",
      "Cannot set summoner spells outside champion select.",
      { gameflowPhase },
    );
  }

  const sessionBefore = await getChampionSelectSession(lcu);
  const localPlayerBefore = getLocalChampSelectPlayer(sessionBefore);

  try {
    await lcu.patch<void, LcuChampSelectMySelectionPatch>("/lol-champ-select/v1/session/my-selection", {
      spell1Id: input.spell1Id,
      spell2Id: input.spell2Id,
    });
  } catch (error) {
    throw new SetSummonerSpellsError(
      "APPLY_FAILED",
      "League Client rejected summoner spell update.",
      {
        spell1Id: input.spell1Id,
        spell2Id: input.spell2Id,
        cause: formatUnknownError(error),
      },
    );
  }

  const localPlayerAfter = await readLocalPlayerAfterUpdate(lcu);
  const applied = localPlayerAfter.spell1Id === input.spell1Id && localPlayerAfter.spell2Id === input.spell2Id;

  if (!applied) {
    throw new SetSummonerSpellsError(
      "VERIFY_FAILED",
      "Summoner spell update was sent, but champion select session does not show the requested spells.",
      {
        expected: input,
        actual: {
          spell1Id: localPlayerAfter.spell1Id,
          spell2Id: localPlayerAfter.spell2Id,
        },
      },
    );
  }

  return {
    spell1Id: localPlayerAfter.spell1Id,
    spell2Id: localPlayerAfter.spell2Id,
    previousSpell1Id: localPlayerBefore.spell1Id,
    previousSpell2Id: localPlayerBefore.spell2Id,
    summonerId: localPlayerAfter.summonerId,
    localPlayerCellId: localPlayerAfter.cellId,
    applied,
  };
}

export async function setSummonerSpells(
  lcu: LeagueClientApi,
  spell1Id: number,
  spell2Id: number,
): Promise<SetSummonerSpellsResult> {
  return setSummonerSpellsDuringChampionSelect(lcu, { spell1Id, spell2Id });
}

async function readLocalPlayerAfterUpdate(lcu: LeagueClientApi): Promise<LcuChampSelectPlayer> {
  try {
    const sessionAfter = await getChampionSelectSession(lcu);
    return getLocalChampSelectPlayer(sessionAfter);
  } catch (error) {
    throw new SetSummonerSpellsError(
      "VERIFY_FAILED",
      "Could not verify summoner spell update after applying it.",
      { cause: formatUnknownError(error) },
    );
  }
}

function validateSummonerSpellIds(spell1Id: number, spell2Id: number): void {
  if (!isValidSummonerSpellId(spell1Id)) {
    throw new SetSummonerSpellsError("INVALID_SPELL_ID", "spell1Id must be a positive integer.", {
      spell1Id,
    });
  }

  if (!isValidSummonerSpellId(spell2Id)) {
    throw new SetSummonerSpellsError("INVALID_SPELL_ID", "spell2Id must be a positive integer.", {
      spell2Id,
    });
  }

  if (spell1Id === spell2Id) {
    throw new SetSummonerSpellsError("SAME_SPELL", "spell1Id and spell2Id must be different.", {
      spell1Id,
      spell2Id,
    });
  }
}

function isValidSummonerSpellId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
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
