import { describe, expect, it } from "vitest";
import { parseBuildImportText, toRecommendationJsonEntry } from "../src-node/services/BuildImportService";
import type { DataDragonData } from "../src-node/riot/dataDragon";

describe("BuildImportService", () => {
  it("maps champion, runes and summoner spells from text", () => {
    const parsed = parseBuildImportText(
      [
        "Champion: Ahri",
        "Role: MID",
        "Runes: Electrocute, Taste of Blood, Treasure Hunter, Ultimate Hunter, Manaflow Band, Scorch",
        "Summoners: Flash, Ignite",
        "Win rate: 52.3%",
      ].join("\n"),
      dataDragon,
    );

    expect(parsed.championId).toBe(103);
    expect(parsed.role).toBe("middle");
    expect(parsed.primaryStyleId).toBe(8100);
    expect(parsed.subStyleId).toBe(8200);
    expect(parsed.summonerSpellIds).toEqual([4, 14]);
    expect(parsed.winRate).toBe(52.3);
    expect(toRecommendationJsonEntry(parsed).source).toBeUndefined();
  });
});

const dataDragon: DataDragonData = {
  version: "26.10",
  language: "en_US",
  champions: {
    Ahri: {
      version: "26.10",
      id: "Ahri",
      key: "103",
      name: "Ahri",
      title: "",
      blurb: "",
      info: { attack: 0, defense: 0, magic: 0, difficulty: 0 },
      image: { full: "", sprite: "", group: "", x: 0, y: 0, w: 0, h: 0 },
      tags: ["Mage"],
      partype: "",
      stats: {},
    },
  },
  summonerSpells: {
    SummonerFlash: spell("SummonerFlash", "Flash", "4"),
    SummonerDot: spell("SummonerDot", "Ignite", "14"),
  },
  perkStyles: [
    {
      id: 8100,
      key: "Domination",
      icon: "",
      name: "Domination",
      slots: [
        { runes: [rune(8112, "Electrocute")] },
        { runes: [rune(8139, "Taste of Blood")] },
        { runes: [rune(8135, "Treasure Hunter")] },
        { runes: [rune(8106, "Ultimate Hunter")] },
      ],
    },
    {
      id: 8200,
      key: "Sorcery",
      icon: "",
      name: "Sorcery",
      slots: [
        { runes: [rune(8226, "Manaflow Band")] },
        { runes: [rune(8236, "Scorch")] },
      ],
    },
  ],
};

function rune(id: number, name: string) {
  return { id, name, key: name.replace(/\s/g, ""), icon: "", shortDesc: "", longDesc: "" };
}

function spell(id: string, name: string, key: string) {
  return {
    id,
    name,
    key,
    description: "",
    tooltip: "",
    maxrank: 1,
    cooldown: [],
    cooldownBurn: "",
    cost: [],
    costBurn: "",
    datavalues: {},
    effect: [],
    effectBurn: [],
    vars: [],
    summonerLevel: 1,
    modes: [],
    costType: "",
    maxammo: "",
    range: [],
    rangeBurn: "",
    image: { full: "", sprite: "", group: "", x: 0, y: 0, w: 0, h: 0 },
    resource: "",
  };
}
