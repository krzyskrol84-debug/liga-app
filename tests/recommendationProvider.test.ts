import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RecommendationProvider,
  RecommendationProviderError,
} from "../src-node/recommendations/RecommendationProvider";

let tempDir: string;
let recommendationsPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "liga-test-"));
  recommendationsPath = path.join(tempDir, "recommendations.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("RecommendationProvider", () => {
  it("returns an exact champion and role recommendation", async () => {
    await writeFile(
      recommendationsPath,
      JSON.stringify([
        {
          champion: "Ahri",
          role: "middle",
          primaryStyle: "Domination",
          subStyle: "Sorcery",
          selectedPerkIds: [8112, 8139, 8135, 8106, 8226, 8236, 5008, 5008, 5011],
          summonerSpellIds: [4, 14],
          winRate: 51.2,
          pickRate: 8.4,
          gamesCount: 12000,
          patch: "",
        },
      ]),
      "utf8",
    );

    const provider = new RecommendationProvider({ recommendationsPath });
    const result = await provider.getRecommendation("Ahri", "middle");

    expect(result.runes.primaryStyle).toBe("Domination");
    expect(result.summonerSpells.ids).toEqual([4, 14]);
    expect(result.stats.winRate).toBe(51.2);
    expect(result.isExactRoleMatch).toBe(true);
  });

  it("falls back to the best champion recommendation when role is missing", async () => {
    await writeFile(
      recommendationsPath,
      JSON.stringify([
        {
          champion: "Lux",
          role: "utility",
          primaryStyle: "Sorcery",
          subStyle: "Domination",
          selectedPerkIds: [8229, 8226, 8210, 8237, 8139, 8106, 5008, 5008, 5011],
          summonerSpellIds: [4, 14],
          winRate: 50.4,
          pickRate: 10.6,
          gamesCount: 15600,
          patch: "26.10.1",
        },
      ]),
      "utf8",
    );

    const provider = new RecommendationProvider({ recommendationsPath });
    const result = await provider.getRecommendation("Lux", "middle");

    expect(result.matchedRole).toBe("utility");
    expect(result.isExactRoleMatch).toBe(false);
  });

  it("can resolve a recommendation by championId", async () => {
    await writeFile(
      recommendationsPath,
      JSON.stringify([
        {
          champion: "Ahri",
          role: "middle",
          primaryStyle: "Domination",
          subStyle: "Sorcery",
          selectedPerkIds: [8112, 8139, 8135, 8106, 8226, 8236, 5008, 5008, 5011],
          summonerSpellIds: [4, 14],
          winRate: 51.2,
          pickRate: 8.4,
          gamesCount: 12000,
          patch: "26.10",
        },
      ]),
      "utf8",
    );

    const provider = new RecommendationProvider({ recommendationsPath });
    const result = await provider.getRecommendation(103, "middle");

    expect(result.championId).toBe(103);
    expect(result.runes.primaryStyleId).toBe(8100);
    expect(result.runes.subStyleId).toBe(8200);
    expect(result.source).toBe("local-json");
  });

  it("selects the best build for the requested championId and role", async () => {
    await writeFile(
      recommendationsPath,
      JSON.stringify([
        {
          buildId: "ahri-mid-safe",
          championId: 103,
          champion: "Ahri",
          role: "MID",
          primaryStyle: "Sorcery",
          subStyle: "Inspiration",
          selectedPerkIds: [8214, 8226, 8210, 8237, 8304, 8347, 5008, 5008, 5011],
          summonerSpellIds: [4, 12],
          winRate: 50.9,
          pickRate: 5.8,
          gamesCount: 7900,
          patch: "26.10",
        },
        {
          buildId: "ahri-mid-burst",
          championId: 103,
          champion: "Ahri",
          role: "middle",
          primaryStyle: "Domination",
          subStyle: "Sorcery",
          selectedPerkIds: [8112, 8139, 8135, 8106, 8226, 8236, 5008, 5008, 5011],
          summonerSpellIds: [4, 14],
          winRate: 52.1,
          pickRate: 8.4,
          gamesCount: 12000,
          patch: "26.10",
        },
      ]),
      "utf8",
    );

    const provider = new RecommendationProvider({ recommendationsPath });
    const result = await provider.getRecommendation(103, "MID");

    expect(result.buildId).toBe("ahri-mid-burst");
    expect(result.requestedRole).toBe("middle");
    expect(result.matchedRole).toBe("middle");
    expect(result.isExactRoleMatch).toBe(true);
    expect(result.isFallback).toBe(false);
  });

  it("uses an explicit fallback build when exact role is missing", async () => {
    await writeFile(
      recommendationsPath,
      JSON.stringify([
        {
          buildId: "ahri-support-fallback",
          championId: 103,
          champion: "Ahri",
          role: "SUPPORT",
          fallback: true,
          primaryStyle: "Domination",
          subStyle: "Sorcery",
          selectedPerkIds: [8112, 8139, 8135, 8106, 8226, 8236, 5008, 5008, 5011],
          summonerSpellIds: [4, 14],
          winRate: 49.1,
          pickRate: 1.1,
          gamesCount: 900,
          patch: "26.10",
        },
        {
          buildId: "ahri-mid-highest",
          championId: 103,
          champion: "Ahri",
          role: "MID",
          primaryStyle: "Sorcery",
          subStyle: "Inspiration",
          selectedPerkIds: [8214, 8226, 8210, 8237, 8304, 8347, 5008, 5008, 5011],
          summonerSpellIds: [4, 12],
          winRate: 55.0,
          pickRate: 5.8,
          gamesCount: 7900,
          patch: "26.10",
        },
      ]),
      "utf8",
    );

    const provider = new RecommendationProvider({ recommendationsPath });

    await expect(provider.getRecommendation(103, "APC")).rejects.toMatchObject({
      code: "INVALID_ROLE",
    });
  });

  it("returns all build proposals for one champion role", async () => {
    await writeFile(
      recommendationsPath,
      JSON.stringify([
        {
          buildId: "naafiri-mid-winrate",
          label: "Best Win Rate",
          championId: 950,
          champion: "Naafiri",
          role: "MID",
          primaryStyle: "Domination",
          subStyle: "Precision",
          selectedPerkIds: [8112, 8143, 8135, 8106, 9111, 8014, 5008, 5008, 5011],
          summonerSpellIds: [4, 14],
          winRate: 53.2,
          pickRate: 5.4,
          gamesCount: 9000,
          patch: "26.10",
        },
        {
          buildId: "naafiri-mid-popular",
          label: "Most Popular",
          championId: 950,
          champion: "Naafiri",
          role: "MID",
          primaryStyle: "Domination",
          subStyle: "Precision",
          selectedPerkIds: [8112, 8143, 8135, 8106, 9111, 8014, 5008, 5008, 5011],
          summonerSpellIds: [4, 14],
          winRate: 51.5,
          pickRate: 8.8,
          gamesCount: 20000,
          patch: "26.10",
        },
      ]),
      "utf8",
    );

    const provider = new RecommendationProvider({ recommendationsPath });
    const result = await provider.getRecommendations(950, "MID");

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.label)).toEqual(["Best Win Rate", "Most Popular"]);
    expect(result.every((item) => item.isExactRoleMatch)).toBe(true);
  });

  it("rejects malformed recommendations", async () => {
    await writeFile(recommendationsPath, JSON.stringify([{ champion: "Ahri" }]), "utf8");

    const provider = new RecommendationProvider({ recommendationsPath });

    await expect(provider.loadRecommendations()).rejects.toThrow(RecommendationProviderError);
  });
});
