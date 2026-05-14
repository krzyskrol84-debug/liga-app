import {
  detectChampionSelect,
  getCurrentGameflowPhase,
  type LcuChampSelectAction,
} from "../league/champSelect.js";
import type { LeagueClientApi } from "../league/lcuClient.js";
import { findLocalInProgressAction } from "../league/pickBan.js";
import { isChampionRole } from "../models/domain.js";
import type { ChampionSelectState } from "../models/appModels.js";

export class GameflowService {
  constructor(private readonly lcu: LeagueClientApi) {}

  getPhase() {
    return getCurrentGameflowPhase(this.lcu);
  }

  async isReadyCheck(): Promise<boolean> {
    return (await this.getPhase()) === "ReadyCheck";
  }

  async isChampSelect(): Promise<boolean> {
    return (await this.getPhase()) === "ChampSelect";
  }

  async isInProgress(): Promise<boolean> {
    return (await this.getPhase()) === "InProgress";
  }

  async getChampionSelectState(): Promise<ChampionSelectState> {
    const detection = await detectChampionSelect(this.lcu);

    if (!detection.isInChampionSelect) {
      return {
        active: false,
        championId: null,
        assignedPosition: null,
        summonerId: null,
        pickActionId: null,
        banActionId: null,
      };
    }

    const pickAction = findLocalInProgressAction(detection.session, "pick");
    const banAction = findLocalInProgressAction(detection.session, "ban");
    const assignedPosition = isChampionRole(detection.assignedPosition) ? detection.assignedPosition : null;

    return {
      active: true,
      championId: detection.championId > 0 ? detection.championId : null,
      assignedPosition,
      summonerId: detection.summonerId,
      pickActionId: pickAction?.id ?? null,
      banActionId: banAction?.id ?? null,
    };
  }

  getLocalPickAction(actions: LcuChampSelectAction[][], localPlayerCellId: number) {
    return actions.flat().find((action) => action.actorCellId === localPlayerCellId && action.type === "pick") ?? null;
  }
}
