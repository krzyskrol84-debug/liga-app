import { describe, expect, it } from "vitest";
import { findLocalInProgressAction } from "../src-node/league/pickBan";
import type { LcuChampSelectSession } from "../src-node/league/champSelect";

const baseSession: LcuChampSelectSession = {
  actions: [],
  localPlayerCellId: 2,
  myTeam: [],
  theirTeam: [],
};

describe("pick/ban helpers", () => {
  it("finds the local in-progress pick action", () => {
    const session: LcuChampSelectSession = {
      ...baseSession,
      actions: [
        [
          {
            actorCellId: 2,
            championId: 0,
            completed: false,
            id: 12,
            isAllyAction: true,
            isInProgress: true,
            pickTurn: 1,
            type: "pick",
          },
        ],
      ],
    };

    expect(findLocalInProgressAction(session, "pick")?.id).toBe(12);
  });

  it("ignores actions owned by another player", () => {
    const session: LcuChampSelectSession = {
      ...baseSession,
      actions: [
        [
          {
            actorCellId: 3,
            championId: 0,
            completed: false,
            id: 99,
            isAllyAction: true,
            isInProgress: true,
            pickTurn: 1,
            type: "ban",
          },
        ],
      ],
    };

    expect(findLocalInProgressAction(session, "ban")).toBeNull();
  });
});
