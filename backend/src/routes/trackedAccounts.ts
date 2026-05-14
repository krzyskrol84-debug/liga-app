import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  RiotApiClient,
  RiotApiError,
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

const createTrackedAccountSchema = z.object({
  gameName: z.string().trim().min(1, "gameName is required"),
  tagLine: z.string().trim().min(1, "tagLine is required"),
  platformRegion: platformRegionSchema,
  routingRegion: routingRegionSchema,
});

export const trackedAccountsRouter = Router();

trackedAccountsRouter.post("/", async (request, response) => {
  const parsed = createTrackedAccountSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid request body.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const account = await riotApiClient.getAccountByRiotId(
      parsed.data.gameName,
      parsed.data.tagLine,
      parsed.data.platformRegion as PlatformRegion,
    );

    const trackedAccount = await prisma.trackedAccount.upsert({
      where: {
        puuid: account.puuid,
      },
      update: {
        gameName: parsed.data.gameName,
        tagLine: parsed.data.tagLine,
        platformRegion: parsed.data.platformRegion,
        routingRegion: parsed.data.routingRegion,
      },
      create: {
        gameName: parsed.data.gameName,
        tagLine: parsed.data.tagLine,
        puuid: account.puuid,
        platformRegion: parsed.data.platformRegion,
        routingRegion: parsed.data.routingRegion,
      },
    });

    return response.status(201).json({
      ok: true,
      trackedAccount: serializeTrackedAccount(trackedAccount),
    });
  } catch (error) {
    return sendTrackedAccountError(response, error);
  }
});

trackedAccountsRouter.get("/", async (_request, response) => {
  const trackedAccounts = await prisma.trackedAccount.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return response.json({
    ok: true,
    trackedAccounts: trackedAccounts.map(serializeTrackedAccount),
    count: trackedAccounts.length,
  });
});

function serializeTrackedAccount(account: {
  id: string;
  gameName: string;
  tagLine: string;
  puuid: string;
  platformRegion: string;
  routingRegion: string;
  lastFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: account.id,
    gameName: account.gameName,
    tagLine: account.tagLine,
    puuid: account.puuid,
    platformRegion: account.platformRegion,
    routingRegion: account.routingRegion,
    lastFetchedAt: account.lastFetchedAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function sendTrackedAccountError(response: import("express").Response, error: unknown) {
  if (error instanceof RiotApiError) {
    return response.status(error.status ?? 502).json({
      ok: false,
      error: error.message,
      status: error.status,
    });
  }

  const message = error instanceof Error ? error.message : "Unknown tracked account error";
  return response.status(500).json({
    ok: false,
    error: message,
  });
}
