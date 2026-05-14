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
  RIOT_API_KEY: z.string().min(1, "RIOT_API_KEY is required"),
  CORS_ORIGINS: z.string().optional().default("http://127.0.0.1:1420,http://localhost:1420,http://tauri.localhost"),
  ENABLE_SCHEDULER: z
    .string()
    .optional()
    .transform((value) => value === "true")
    .default("false"),
  STATS_UPDATE_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(6),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(10).max(10_000).default(300),
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
  databaseUrlLoaded: typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0,
  corsOrigins: parsedEnv.data.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
  enableScheduler: parsedEnv.data.ENABLE_SCHEDULER,
  statsUpdateIntervalHours: parsedEnv.data.STATS_UPDATE_INTERVAL_HOURS,
  rateLimitWindowMs: parsedEnv.data.RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: parsedEnv.data.RATE_LIMIT_MAX_REQUESTS,
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
