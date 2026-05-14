import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentDir = dirname(fileURLToPath(import.meta.url));
const backendRootDir = resolve(currentDir, "..");
const envFilePath = resolve(backendRootDir, ".env");

loadEnv({ path: envFilePath });

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  RIOT_API_KEY: z.string().optional().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  CORS_ORIGINS: z.string().optional().default("http://127.0.0.1:1420,http://localhost:1420,http://tauri.localhost"),
  ENABLE_SCHEDULER: z
    .string()
    .optional()
    .transform((value) => value === "true")
    .default("false"),
  STATS_UPDATE_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(6),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(10).max(10_000).default(300),
  RIOT_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  RIOT_MAX_REQUESTS_PER_SECOND: z.coerce.number().int().min(1).max(50).default(15),
  RIOT_MAX_REQUESTS_PER_2MIN: z.coerce.number().int().min(10).max(500).default(90),
  TRACKED_ACCOUNT_COOLDOWN_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  ANALYZER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const message = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid backend environment configuration: ${message}`);
}

export const backendConfig = {
  port: parsedEnv.data.PORT,
  riotApiKey: parsedEnv.data.RIOT_API_KEY,
  logLevel: parsedEnv.data.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  databaseUrlLoaded: typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0,
  corsOrigins: parsedEnv.data.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
  enableScheduler: parsedEnv.data.ENABLE_SCHEDULER,
  statsUpdateIntervalHours: parsedEnv.data.STATS_UPDATE_INTERVAL_HOURS,
  rateLimitWindowMs: parsedEnv.data.RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: parsedEnv.data.RATE_LIMIT_MAX_REQUESTS,
  riotConcurrency: parsedEnv.data.RIOT_CONCURRENCY,
  riotMaxRequestsPerSecond: parsedEnv.data.RIOT_MAX_REQUESTS_PER_SECOND,
  riotMaxRequestsPerTwoMinutes: parsedEnv.data.RIOT_MAX_REQUESTS_PER_2MIN,
  trackedAccountCooldownMinutes: parsedEnv.data.TRACKED_ACCOUNT_COOLDOWN_MINUTES,
  analyzerConcurrency: parsedEnv.data.ANALYZER_CONCURRENCY,
  envFilePath,
} as const;

export function getRiotApiKeyDebugInfo(apiKey: string) {
  const trimmed = apiKey.trim();

  return {
    loaded: trimmed.length > 0,
    prefix: trimmed.slice(0, 8),
    suffix: trimmed.slice(-4),
  } as const;
}

export function getDatabaseUrlDebugInfo(databaseUrl: string | undefined) {
  const trimmed = (databaseUrl ?? "").trim();

  return {
    loaded: trimmed.length > 0,
  } as const;
}
