import { prisma } from "./prisma.js";

export type AnalyzerJobStatus = {
  running: boolean;
  currentJob: string | null;
  progress: number;
  processedMatches: number;
  recommendationStatsAdded: number;
  itemStatsAdded: number;
  matchupStatsAdded: number;
  currentChampion: string | null;
  currentRole: string | null;
  estimatedRemainingMinutes: number | null;
};

type AnalyzerJobProgressPatch = Partial<Omit<AnalyzerJobStatus, "running" | "currentJob">>;

const idleStatus: AnalyzerJobStatus = {
  running: false,
  currentJob: null,
  progress: 0,
  processedMatches: 0,
  recommendationStatsAdded: 0,
  itemStatsAdded: 0,
  matchupStatsAdded: 0,
  currentChampion: null,
  currentRole: null,
  estimatedRemainingMinutes: null,
};

let currentStatus: AnalyzerJobStatus = { ...idleStatus };

export function startAnalyzerJobStatus(currentJob: string): AnalyzerJobStatus {
  currentStatus = {
    ...idleStatus,
    running: true,
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
    estimatedRemainingMinutes: null,
  };

  return getAnalyzerJobStatusSnapshot();
}

export function getAnalyzerJobStatusSnapshot(): AnalyzerJobStatus {
  return { ...currentStatus };
}

export async function getAnalyzerJobStatus(): Promise<AnalyzerJobStatus> {
  if (currentStatus.running) {
    return getAnalyzerJobStatusSnapshot();
  }

  const runningLog = await prisma.fetchJobLog.findFirst({
    where: {
      status: "running",
      jobName: {
        in: ["analyze-global-stats", "analyze-matches", "analyze-matchups"],
      },
    },
    orderBy: {
      startedAt: "desc",
    },
  });

  if (!runningLog) {
    return getAnalyzerJobStatusSnapshot();
  }

  const parsedMetadata = parseStatusMetadata(runningLog.metadata);
  return {
    ...idleStatus,
    ...parsedMetadata,
    running: true,
    currentJob: runningLog.jobName,
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
    };
  } catch {
    return {};
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
