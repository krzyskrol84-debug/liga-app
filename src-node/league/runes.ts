import type { LeagueClientApi } from "./lcuClient.js";
import { getCurrentGameflowPhase } from "./champSelect.js";
import { getPerkStyleIdByName } from "../riot/dataDragon.js";

export type RuneStyleName = "Precision" | "Domination" | "Sorcery" | "Resolve" | "Inspiration" | string;

export type SetRunePageInput = {
  champion: string;
  role: string;
  primaryStyle: RuneStyleName;
  subStyle: RuneStyleName;
  selectedPerkIds: number[];
};

export type LcuRunePage = {
  id: number;
  name: string;
  current: boolean;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
};

export type LcuCreateRunePageRequest = {
  name: string;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
  current: boolean;
};

export type SetRunePageResult = {
  pageId: number;
  name: string;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
  applied: boolean;
};

export class SetRunePageError extends Error {
  readonly code:
    | "NOT_IN_CHAMP_SELECT"
    | "INVALID_STYLE"
    | "INVALID_PERKS"
    | "DELETE_OLD_PAGE_FAILED"
    | "APPLY_FAILED"
    | "VERIFY_FAILED";
  readonly details?: unknown;

  constructor(code: SetRunePageError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "SetRunePageError";
    this.code = code;
    this.details = details;
  }
}

const PAGE_NAME_PREFIX = "Liga";

export async function setRunePageDuringChampionSelect(
  lcu: LeagueClientApi,
  input: SetRunePageInput,
): Promise<SetRunePageResult> {
  validateSelectedPerks(input.selectedPerkIds);

  const gameflowPhase = await getCurrentGameflowPhase(lcu);

  if (gameflowPhase !== "ChampSelect") {
    throw new SetRunePageError("NOT_IN_CHAMP_SELECT", "Cannot set runes outside champion select.", {
      gameflowPhase,
    });
  }

  const primaryStyleId = resolveRuneStyleId(input.primaryStyle);
  const subStyleId = resolveRuneStyleId(input.subStyle);
  const name = `${PAGE_NAME_PREFIX} - ${input.champion} ${input.role}`;

  await deleteExistingLigaPages(lcu);

  let page: LcuRunePage;

  try {
    page = await lcu.post<LcuRunePage, LcuCreateRunePageRequest>("/lol-perks/v1/pages", {
      name,
      primaryStyleId,
      subStyleId,
      selectedPerkIds: input.selectedPerkIds,
      current: true,
    });
  } catch (error) {
    throw new SetRunePageError("APPLY_FAILED", "League Client rejected rune page update.", {
      input,
      cause: formatUnknownError(error),
    });
  }

  const currentPage = await readCurrentRunePage(lcu);
  const applied =
    currentPage.id === page.id &&
    currentPage.primaryStyleId === primaryStyleId &&
    currentPage.subStyleId === subStyleId &&
    haveSamePerks(currentPage.selectedPerkIds, input.selectedPerkIds);

  if (!applied) {
    throw new SetRunePageError("VERIFY_FAILED", "Rune page was created, but current page does not match request.", {
      expected: {
        primaryStyleId,
        subStyleId,
        selectedPerkIds: input.selectedPerkIds,
      },
      actual: currentPage,
    });
  }

  return {
    pageId: currentPage.id,
    name: currentPage.name,
    primaryStyleId: currentPage.primaryStyleId,
    subStyleId: currentPage.subStyleId,
    selectedPerkIds: currentPage.selectedPerkIds,
    applied,
  };
}

export function resolveRuneStyleId(style: RuneStyleName): number {
  const styleId = getPerkStyleIdByName(style);

  if (!styleId) {
    throw new SetRunePageError("INVALID_STYLE", `Unknown rune style: ${style}`, { style });
  }

  return styleId;
}

async function deleteExistingLigaPages(lcu: LeagueClientApi): Promise<void> {
  let pages: LcuRunePage[];

  try {
    pages = await lcu.get<LcuRunePage[]>("/lol-perks/v1/pages");
  } catch (error) {
    throw new SetRunePageError("APPLY_FAILED", "Could not read existing rune pages.", {
      cause: formatUnknownError(error),
    });
  }

  const pagesToDelete = pages.filter((page) => page.name.startsWith(PAGE_NAME_PREFIX));

  try {
    await Promise.all(pagesToDelete.map((page) => lcu.delete<void>(`/lol-perks/v1/pages/${page.id}`)));
  } catch (error) {
    throw new SetRunePageError("DELETE_OLD_PAGE_FAILED", "Could not delete previous Liga rune page.", {
      cause: formatUnknownError(error),
    });
  }
}

async function readCurrentRunePage(lcu: LeagueClientApi): Promise<LcuRunePage> {
  try {
    return await lcu.get<LcuRunePage>("/lol-perks/v1/currentpage");
  } catch (error) {
    throw new SetRunePageError("VERIFY_FAILED", "Could not verify current rune page.", {
      cause: formatUnknownError(error),
    });
  }
}

function validateSelectedPerks(selectedPerkIds: number[]): void {
  if (selectedPerkIds.length !== 9 || !selectedPerkIds.every((id) => Number.isInteger(id) && id > 0)) {
    throw new SetRunePageError("INVALID_PERKS", "selectedPerkIds must contain exactly 9 positive integers.", {
      selectedPerkIds,
    });
  }
}

function haveSamePerks(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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
