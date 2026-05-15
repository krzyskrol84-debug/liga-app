import { Router } from "express";
import { z } from "zod";
import { fetchMatchesJob } from "../jobs/FetchMatchesJob.js";
import { seedRankedAccountsJob } from "../jobs/SeedRankedAccountsJob.js";
import { updateStatsJob, UpdateStatsCooldownError } from "../jobs/UpdateStatsJob.js";
import { fullRefreshJob, FullRefreshAlreadyRunningError } from "../jobs/FullRefreshJob.js";
import { RiotApiError } from "../riot/RiotApiClient.js";
import { matchAnalyzer } from "../analytics/MatchAnalyzer.js";
import { matchupAnalyzer } from "../analytics/MatchupAnalyzer.js";
import { ConcurrentJobError } from "../lib/jobGuards.js";
import { getAnalyzerJobStatus } from "../lib/jobStatus.js";
import { compactMatchRecordsJob } from "../jobs/CompactMatchRecordsJob.js";
import { deleteOldRawMatchesJob } from "../jobs/DeleteOldRawMatchesJob.js";

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

const fetchMatchesBodySchema = z.object({
  gameName: z.string().trim().min(1, "gameName is required"),
  tagLine: z.string().trim().min(1, "tagLine is required"),
  platformRegion: platformRegionSchema,
  routingRegion: routingRegionSchema,
  count: z.coerce.number().int().min(1).max(100).default(20),
});

const updateStatsBodySchema = z.object({
  count: z.coerce.number().int().min(1).max(100).default(80),
}).partial().default({});

const rankedQueueSchema = z.enum(["RANKED_SOLO_5x5"]);
const rankedTierSchema = z.enum(["CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND_PLUS"]);

const seedRankedAccountsBodySchema = z.object({
  platformRegion: platformRegionSchema,
  routingRegion: routingRegionSchema,
  queue: rankedQueueSchema,
  tiers: z.array(rankedTierSchema).min(1).default(["CHALLENGER", "GRANDMASTER", "MASTER"]),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

const fullRefreshBodySchema = seedRankedAccountsBodySchema.extend({
  count: z.coerce.number().int().min(1).max(100).default(80),
});
const deleteOldRawMatchesBodySchema = z.object({
  olderThanDays: z.coerce.number().int().min(0).max(3650).default(30),
}).partial().default({});

export const jobsRouter = Router();

jobsRouter.get("/status", async (_request, response, next) => {
  try {
    return response.json(await getAnalyzerJobStatus());
  } catch (error) {
    next(error);
  }
});

jobsRouter.post("/fetch-matches", async (request, response) => {
  const parsed = fetchMatchesBodySchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid request body.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await fetchMatchesJob.run(parsed.data);
    return response.status(200).json(result);
  } catch (error) {
    return sendJobError(response, error);
  }
});

jobsRouter.post("/analyze-matches", async (_request, response) => {
  try {
    const result = await matchAnalyzer.analyzeSavedMatches();
    return response.status(200).json(result);
  } catch (error) {
    return sendJobError(response, error);
  }
});

jobsRouter.post("/analyze-matchups", async (_request, response) => {
  try {
    const result = await matchupAnalyzer.analyzeSavedMatchups();
    return response.status(200).json(result);
  } catch (error) {
    return sendJobError(response, error);
  }
});

jobsRouter.post("/analyze-global-stats", async (_request, response) => {
  try {
    const result = await matchAnalyzer.analyzeGlobalStats();
    return response.status(200).json(result);
  } catch (error) {
    return sendJobError(response, error);
  }
});

jobsRouter.post("/update-stats", async (request, response) => {
  const parsed = updateStatsBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid request body.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await updateStatsJob.run(parsed.data);
    return response.status(200).json(result);
  } catch (error) {
    return sendJobError(response, error);
  }
});

jobsRouter.post("/seed-ranked-accounts", async (request, response) => {
  const parsed = seedRankedAccountsBodySchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid request body.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await seedRankedAccountsJob.run(parsed.data);
    return response.status(200).json(result);
  } catch (error) {
    return sendJobError(response, error);
  }
});

jobsRouter.post("/full-refresh", async (request, response) => {
  const parsed = fullRefreshBodySchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid request body.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await fullRefreshJob.run(parsed.data);
    return response.status(200).json({
      ok: true,
      summary: result.summary,
    });
  } catch (error) {
    return sendJobError(response, error);
  }
});

jobsRouter.post("/compact-match-records", async (_request, response) => {
  try {
    const result = await compactMatchRecordsJob.run();
    return response.status(200).json(result);
  } catch (error) {
    return sendJobError(response, error);
  }
});

jobsRouter.post("/delete-old-raw-matches", async (request, response) => {
  const parsed = deleteOldRawMatchesBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return response.status(400).json({
      ok: false,
      error: "Invalid request body.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await deleteOldRawMatchesJob.run({
      olderThanDays: parsed.data.olderThanDays ?? 30,
    });
    return response.status(200).json(result);
  } catch (error) {
    return sendJobError(response, error);
  }
});

function sendJobError(
  response: import("express").Response,
  error: unknown,
) {
  if (error instanceof RiotApiError) {
    return response.status(error.status ?? 502).json({
      ok: false,
      error: error.message,
      status: error.status,
    });
  }

  if (error instanceof UpdateStatsCooldownError) {
    return response.status(429).json({
      ok: false,
      error: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }

  if (error instanceof FullRefreshAlreadyRunningError) {
    return response.status(409).json({
      ok: false,
      error: error.message,
    });
  }

  if (error instanceof ConcurrentJobError) {
    return response.status(409).json({
      ok: false,
      error: error.message,
    });
  }

  const message = error instanceof Error ? error.message : "Unknown fetch job error";
  return response.status(500).json({
    ok: false,
    error: message,
  });
}
