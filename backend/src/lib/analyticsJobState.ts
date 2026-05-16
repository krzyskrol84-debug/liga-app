import { prisma } from "./prisma.js";

export type AnalyticsJobStage =
  | "seeding-accounts"
  | "fetching-matches"
  | "compacting-matches"
  | "analyzing-stats"
  | "cleaning-raw-payloads"
  | "completed"
  | "failed";

export type AnalyticsJobStatus = "idle" | "running" | "completed" | "failed";

export type AnalyticsJobStatePatch = {
  status?: AnalyticsJobStatus;
  currentStage?: AnalyticsJobStage;
  currentJob?: string | null;
  progress?: number;
  processedMatches?: number;
  recommendationStatsAdded?: number;
  itemStatsAdded?: number;
  matchupStatsAdded?: number;
  currentChampion?: string | null;
  currentRole?: string | null;
  errorMessage?: string | null;
  metadata?: unknown;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  lastStatsUpdatedAt?: Date | null;
};

const GLOBAL_ANALYTICS_JOB_STATE_ID = "global";

export async function setAnalyticsJobState(patch: AnalyticsJobStatePatch) {
  const data = normalizePatch(patch);

  return prisma.analyticsJobState.upsert({
    where: {
      id: GLOBAL_ANALYTICS_JOB_STATE_ID,
    },
    create: {
      id: GLOBAL_ANALYTICS_JOB_STATE_ID,
      status: data.status ?? "idle",
      currentStage: data.currentStage ?? "completed",
      ...data,
    },
    update: data,
  });
}

export async function getAnalyticsJobState() {
  return prisma.analyticsJobState.findUnique({
    where: {
      id: GLOBAL_ANALYTICS_JOB_STATE_ID,
    },
  });
}

export async function markAnalyticsJobFailed(error: unknown, patch: AnalyticsJobStatePatch = {}) {
  return setAnalyticsJobState({
    ...patch,
    status: "failed",
    currentStage: "failed",
    errorMessage: getSafeErrorMessage(error),
    finishedAt: new Date(),
  });
}

function normalizePatch(patch: AnalyticsJobStatePatch) {
  return {
    ...patch,
    progress: patch.progress === undefined ? undefined : clampProgress(patch.progress),
    metadata: patch.metadata === undefined ? undefined : JSON.stringify(patch.metadata),
  };
}

function clampProgress(progress: number) {
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function getSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
