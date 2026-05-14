import { prisma } from "./prisma.js";
import { RiotApiClient } from "../riot/RiotApiClient.js";
import { getAnalyticsJobState } from "./analyticsJobState.js";

export type AnalyzerJobStatus = {
  running: boolean;
  status: string;
  currentStage: string;
  currentJob: string | null;
  progress: number;
  processedMatches: number;
  recommendationStatsAdded: number;
  itemStatsAdded: number;
  matchupStatsAdded: number;
  currentChampion: string | null;
  currentRole: string | null;
  estimatedRemainingMinutes: number | null;
  queueSize: number;
  matchesPerMinute: number;
  requestsPerMinute: number;
  currentConcurrency: number;
  retryCount: number;
  eta: number | null;
  errorMessage: string | null;
};

type AnalyzerJobProgressPatch = Partial<Omit<AnalyzerJobStatus, "running" | "currentJob">>;

const idleStatus: AnalyzerJobStatus = {
  running: false,
  status: "idle",
  currentStage: "completed",
  currentJob: null,
  progress: 0,
  processedMatches: 0,
  recommendationStatsAdded: 0,
  itemStatsAdded: 0,
  matchupStatsAdded: 0,
  currentChampion: null,
  currentRole: null,
  estimatedRemainingMinutes: null,
  queueSize: 0,
  matchesPerMinute: 0,
  requestsPerMinute: 0,
  currentConcurrency: 0,
  retryCount: 0,
  eta: null,
  errorMessage: null,
};

let currentStatus: AnalyzerJobStatus = { ...idleStatus };

export function startAnalyzerJobStatus(currentJob: string): AnalyzerJobStatus {
  currentStatus = {
    ...idleStatus,
    running: true,
    status: "running",
    currentStage: "analyzing-stats",
    currentJob,
  };

  return getAnalyzerJobStatusSnapshot();
}

export function updateAnalyzerJobStatus(patch: AnalyzerJobProgressPatch): AnalyzerJobStatus {
  currentStatus = {
    ...currentStatus,
    ...patch,
    running: currentStatus.running,
    currentJob: currentStatus.currentJob,
  };

  return getAnalyzerJobStatusSnapshot();
}

export function finishAnalyzerJobStatus(patch: AnalyzerJobProgressPatch = {}): AnalyzerJobStatus {
  currentStatus = {
    ...currentStatus,
    ...patch,
    running: false,
    status: "completed",
    currentStage: "completed",
    progress: patch.progress ?? 100,
    estimatedRemainingMinutes: null,
  };

  return getAnalyzerJobStatusSnapshot();
}

export function failAnalyzerJobStatus(patch: AnalyzerJobProgressPatch = {}): AnalyzerJobStatus {
  currentStatus = {
    ...currentStatus,
    ...patch,
    running: false,
    status: "failed",
    currentStage: "failed",
    estimatedRemainingMinutes: null,
  };

  return getAnalyzerJobStatusSnapshot();
}

export function getAnalyzerJobStatusSnapshot(): AnalyzerJobStatus {
  return { ...currentStatus };
}

export async function getAnalyzerJobStatus(): Promise<AnalyzerJobStatus> {
  const metrics = await getBackendJobMetrics();
  const persistentState = await getAnalyticsJobState();
  if (persistentState) {
    return {
      ...idleStatus,
      running: persistentState.status === "running",
      status: persistentState.status,
      currentStage: persistentState.currentStage,
      currentJob: persistentState.currentJob
        ? `${persistentState.currentJob}:${persistentState.currentStage}`
        : persistentState.currentStage,
      progress: persistentState.progress,
      processedMatches: persistentState.processedMatches,
      recommendationStatsAdded: persistentState.recommendationStatsAdded,
      itemStatsAdded: persistentState.itemStatsAdded,
      matchupStatsAdded: persistentState.matchupStatsAdded,
      currentChampion: persistentState.currentChampion,
      currentRole: persistentState.currentRole,
      errorMessage: persistentState.errorMessage,
      estimatedRemainingMinutes: metrics.eta,
      ...metrics,
    };
  }

  if (currentStatus.running) {
    return {
      ...getAnalyzerJobStatusSnapshot(),
      ...metrics,
    };
  }

  const runningLog = await prisma.fetchJobLog.findFirst({
    where: {
      status: "running",
      jobName: {
        in: [
          "analyze-global-stats",
          "analyze-matches",
          "analyze-matchups",
          "update-stats",
          "seed-ranked-accounts",
          "full-refresh",
          "scheduler.full-refresh",
        ],
      },
    },
    orderBy: {
      startedAt: "desc",
    },
  });

  if (!runningLog) {
    return {
      ...getAnalyzerJobStatusSnapshot(),
      ...metrics,
    };
  }

  const parsedMetadata = parseStatusMetadata(runningLog.metadata);
  return {
    ...idleStatus,
    ...parsedMetadata,
    running: true,
    status: "running",
    currentJob: readCurrentJob(runningLog.jobName, runningLog.metadata),
  };
}

export function serializeAnalyzerJobStatus(status: AnalyzerJobStatus) {
  return JSON.stringify({
    jobStatus: status,
  });
}

export function parseStatusMetadata(metadata: string | null): Partial<AnalyzerJobStatus> {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const record = parsed as Record<string, unknown>;
    const source = record.jobStatus && typeof record.jobStatus === "object"
      ? (record.jobStatus as Record<string, unknown>)
      : record;

    return {
      progress: readNumber(source.progress),
      processedMatches: readNumber(source.processedMatches),
      recommendationStatsAdded: readNumber(source.recommendationStatsAdded),
      itemStatsAdded: readNumber(source.itemStatsAdded),
      matchupStatsAdded: readNumber(source.matchupStatsAdded),
      currentChampion: readString(source.currentChampion),
      currentRole: readString(source.currentRole),
    estimatedRemainingMinutes: readNumberOrNull(source.estimatedRemainingMinutes),
    queueSize: readNumber(source.queueSize),
    matchesPerMinute: readNumber(source.matchesPerMinute),
    requestsPerMinute: readNumber(source.requestsPerMinute),
    currentConcurrency: readNumber(source.currentConcurrency),
    retryCount: readNumber(source.retryCount),
    eta: readNumberOrNull(source.eta),
  };
  } catch {
    return {};
  }
}

async function getBackendJobMetrics() {
  const riotMetrics = RiotApiClient.getMetrics();
  const [pending, processing, recentCompleted] = await Promise.all([
    prisma.riotMatchFetchQueue.count({ where: { status: "pending" } }),
    prisma.riotMatchFetchQueue.count({ where: { status: "processing" } }),
    prisma.riotMatchFetchQueue.count({
      where: {
        status: "completed",
        fetchedAt: {
          gte: new Date(Date.now() - 60_000),
        },
      },
    }),
  ]);

  const queueSize = pending + processing;
  const matchesPerMinute = recentCompleted;

  return {
    queueSize,
    matchesPerMinute,
    requestsPerMinute: riotMetrics.requestsPerMinute,
    currentConcurrency: riotMetrics.currentConcurrency,
    retryCount: riotMetrics.retryCount,
    eta: matchesPerMinute > 0 ? Math.ceil(queueSize / matchesPerMinute) : null,
  };
}

function readCurrentJob(jobName: string, metadata: string | null) {
  if (!metadata) {
    return jobName;
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return jobName;
    }

    const record = parsed as Record<string, unknown>;
    const stage = typeof record.stage === "string" ? record.stage : null;
    return stage ? `${jobName}:${stage}` : jobName;
  } catch {
    return jobName;
  }
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNumberOrNull(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  return readNumber(value);
}

function readString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : undefined;
}
