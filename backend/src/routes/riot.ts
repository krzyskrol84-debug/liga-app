import { Router } from "express";
import { z } from "zod";
import {
  RiotApiClient,
  RiotApiError,
  type MatchQueryOptions,
  type PlatformRegion,
  type RoutingRegion,
} from "../riot/RiotApiClient.js";

const riotApiClient = new RiotApiClient();

const platformRegionSchema = z.enum([
  "br1",
  "eun1",
  "euw1",
  "jp1",
  "kr",
  "la1",
  "la2",
  "me1",
  "na1",
  "oc1",
  "ph2",
  "ru",
  "sg2",
  "th2",
  "tr1",
  "tw2",
  "vn2",
]);

const routingRegionSchema = z.enum(["europe", "americas", "asia", "sea"]);

const accountQuerySchema = z.object({
  gameName: z.string().trim().min(1, "gameName is required"),
  tagLine: z.string().trim().min(1, "tagLine is required"),
  platformRegion: platformRegionSchema,
});

const matchesQuerySchema = z.object({
  puuid: z.string().trim().min(1, "puuid is required"),
  routingRegion: routingRegionSchema,
  count: z.coerce.number().int().min(1).max(100).default(20),
});

const challengerQuerySchema = z.object({
  platformRegion: platformRegionSchema,
  queue: z.literal("RANKED_SOLO_5x5").default("RANKED_SOLO_5x5"),
});

export const riotRouter = Router();

riotRouter.get("/account", async (request, response) => {
  const parsed = accountQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid query parameters.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await riotApiClient.getAccountByRiotId(
      parsed.data.gameName,
      parsed.data.tagLine,
      parsed.data.platformRegion as PlatformRegion,
    );

    return response.json({
      ok: true,
      account: result,
    });
  } catch (error) {
    return sendRiotError(response, error);
  }
});

riotRouter.get("/matches", async (request, response) => {
  const parsed = matchesQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid query parameters.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const options: MatchQueryOptions = {
      count: parsed.data.count,
    };

    const result = await riotApiClient.getMatchIdsByPuuid(
      parsed.data.puuid,
      parsed.data.routingRegion as RoutingRegion,
      options,
    );

    return response.json({
      ok: true,
      matchIds: result,
      count: result.length,
    });
  } catch (error) {
    return sendRiotError(response, error);
  }
});

riotRouter.get("/ranked/challenger", async (request, response) => {
  const parsed = challengerQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid query parameters.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await riotApiClient.getChallengerLeague(
      parsed.data.queue,
      parsed.data.platformRegion as PlatformRegion,
    );

    return response.json({
      ok: true,
      tier: result.tier ?? "CHALLENGER",
      queue: result.queue ?? parsed.data.queue,
      name: result.name ?? null,
      entries: (result.entries ?? []).slice(0, 10),
      count: Math.min((result.entries ?? []).length, 10),
    });
  } catch (error) {
    return sendRiotError(response, error);
  }
});

function sendRiotError(response: Parameters<typeof riotRouter.get>[1] extends never ? never : import("express").Response, error: unknown) {
  if (error instanceof RiotApiError) {
    return response.status(error.status ?? 502).json({
      ok: false,
      error: error.message,
      status: error.status,
    });
  }

  const message = error instanceof Error ? error.message : "Unknown Riot API error";
  return response.status(500).json({
    ok: false,
    error: message,
  });
}
