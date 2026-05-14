import { describe, expect, it } from "vitest";
import {
  isCachePatchStale,
  mapItemId,
  mapItemIds,
  mapSelectedPerkIds,
  mapSummonerSpellIds,
  type DataDragonData,
} from "../src-node/riot/dataDragon";

const dataDragon = {
  version: "26.10.1",
  language: "en_US",
  champions: {
    Ahri: {
      key: "103",
      name: "Ahri",
      id: "Ahri",
      image: { full: "Ahri.png" },
    },
  },
  summonerSpells: {
    SummonerFlash: {
      id: "SummonerFlash",
      key: "4",
      name: "Flash",
      image: { full: "SummonerFlash.png" },
    },
    SummonerDot: {
      id: "SummonerDot",
      key: "14",
      name: "Ignite",
      image: { full: "SummonerDot.png" },
    },
  },
  items: {
    "1056": {
      name: "Doran's Ring",
      description: "",
      colloq: "",
      plaintext: "",
      image: { full: "1056.png" },
      gold: { base: 400, purchasable: true, total: 400, sell: 160 },
      tags: ["Lane"],
      maps: { "11": true },
      stats: {},
    },
    "6655": {
      name: "Luden's Companion",
      description: "",
      colloq: "",
      plaintext: "",
      image: { full: "6655.png" },
      gold: { base: 600, purchasable: true, total: 2900, sell: 2030 },
      tags: ["SpellDamage"],
      maps: { "11": true },
      stats: {},
    },
  },
  perkStyles: [
    {
      id: 8100,
      key: "Domination",
      name: "Domination",
      icon: "perk-images/Styles/7200_Domination.png",
      slots: [
        {
          runes: [
            {
              id: 8112,
              key: "Electrocute",
              name: "Electrocute",
              icon: "perk-images/Styles/Domination/Electrocute/Electrocute.png",
            },
          ],
        },
      ],
    },
  ],
} as DataDragonData;

describe("DataDragonService helpers", () => {
  it("maps rune IDs to Data Dragon names", () => {
    const [electrocute, adaptiveForce] = mapSelectedPerkIds(dataDragon, [8112, 5008]);

    expect(electrocute.name).toBe("Electrocute");
    expect(electrocute.exists).toBe(true);
    expect(adaptiveForce.name).toBe("Adaptive Force");
    expect(adaptiveForce.exists).toBe(true);
  });

  it("maps summoner spell IDs to names and icons", () => {
    const spells = mapSummonerSpellIds(dataDragon, [4, 14]);

    expect(spells.map((spell) => spell.name)).toEqual(["Flash", "Ignite"]);
    expect(spells[0].iconUrl).toContain("SummonerFlash.png");
  });

  it("maps item IDs to names and icons", () => {
    const doransRing = mapItemId(dataDragon, 1056);
    const [ludens, unknown] = mapItemIds(dataDragon, [6655, 999999]);

    expect(doransRing.name).toBe("Doran's Ring");
    expect(doransRing.iconUrl).toContain("/cdn/26.10.1/img/item/1056.png");
    expect(ludens.name).toBe("Luden's Companion");
    expect(unknown.name).toBe("Item 999999");
    expect(unknown.exists).toBe(false);
  });

  it("detects stale Data Dragon cache patches", () => {
    expect(isCachePatchStale({ version: "26.10.0", language: "en_US" }, "26.10.1")).toBe(true);
    expect(isCachePatchStale({ version: "26.10.1", language: "en_US" }, "26.10.1")).toBe(false);
  });
});
