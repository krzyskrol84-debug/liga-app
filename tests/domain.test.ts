import { describe, expect, it } from "vitest";
import { createSelectedPerkIds, formatRate, isChampionRole } from "../src-node/models/domain";

describe("domain helpers", () => {
  it("creates selected perk ids in League rune page order", () => {
    const ids = createSelectedPerkIds({
      primaryRunes: [{ id: 8112 }, { id: 8139 }, { id: 8135 }, { id: 8106 }],
      secondaryRunes: [{ id: 8226 }, { id: 8236 }],
      statShards: [5008, 5008, 5011],
    });

    expect(ids).toEqual([8112, 8139, 8135, 8106, 8226, 8236, 5008, 5008, 5011]);
  });

  it("validates supported roles", () => {
    expect(isChampionRole("middle")).toBe(true);
    expect(isChampionRole("mid")).toBe(false);
  });

  it("formats rates", () => {
    expect(formatRate(51.234)).toBe("51.2%");
  });
});
