import { backendConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { getAnalyticsJobState, setAnalyticsJobState } from "../lib/analyticsJobState.js";
import { fullRefreshJob, FullRefreshAlreadyRunningError, type FullRefreshJobInput } from "./FullRefreshJob.js";

const schedulerInput: FullRefreshJobInput = {
  platformRegion: "eun1",
  routingRegion: "europe",
  queue: "RANKED_SOLO_5x5",
  tiers: ["CHALLENGER", "GRANDMASTER", "MASTER"],
  limit: 1000,
  count: 80,
};

export class StatsScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isTickRunning = false;
  private recoveredInterruptedRun = false;

  start() {
    if (!backendConfig.enableScheduler || this.timer) {
      return;
    }

    const intervalMs = backendConfig.statsUpdateIntervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.runTick();
    }, intervalMs);

    void this.startWorker();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus() {
    return {
      enabled: backendConfig.enableScheduler,
      intervalHours: backendConfig.statsUpdateIntervalHours,
      running: this.isTickRunning,
    } as const;
  }

  private async runTick() {
    if (this.isTickRunning) {
      logInfo("[scheduler] analytics worker tick skipped; job already running");
      return;
    }

    const runningJob = await findRunningAnalyticsJob();
    if (runningJob) {
      logInfo("[scheduler] analytics worker tick skipped; backend job already running", {
        jobName: runningJob.jobName,
        startedAt: runningJob.startedAt.toISOString(),
      });
      return;
    }

    this.isTickRunning = true;
    const startedAt = new Date();
    const log = await prisma.fetchJobLog.create({
      data: {
        jobName: "scheduler.full-refresh",
        status: "running",
        target: `${schedulerInput.platformRegion}:${schedulerInput.queue}`,
        startedAt,
        metadata: JSON.stringify({
          trigger: "scheduler",
          intervalHours: backendConfig.statsUpdateIntervalHours,
          input: schedulerInput,
          stage: "starting",
          progress: 0,
        }),
      },
    });

    try {
      await this.updateSchedulerLog(log.id, startedAt, {
        stage: "full-refresh",
        progress: 5,
      });
      const result = await fullRefreshJob.run(schedulerInput);
      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: {
          id: log.id,
        },
        data: {
          status: "completed",
          finishedAt,
          durationMs: result.summary.durationMs,
          recordsSaved: result.summary.fetchedMatches,
          metadata: JSON.stringify({
            ...result.summary,
            trigger: "scheduler",
            stage: "completed",
            progress: 100,
            lastStatsUpdatedAt: finishedAt.toISOString(),
          }),
        },
      });
      logInfo("[scheduler] analytics worker completed", result.summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scheduler full-refresh error";
      const skipped = error instanceof FullRefreshAlreadyRunningError;
      await prisma.fetchJobLog.update({
        where: {
          id: log.id,
        },
        data: {
          status: skipped ? "completed" : "failed",
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          errorMessage: message,
          metadata: JSON.stringify({
            skipped,
            trigger: "scheduler",
            stage: skipped ? "skipped-already-running" : "failed",
            progress: skipped ? 0 : undefined,
          }),
        },
      });
      logWarn("[scheduler] analytics worker tick failed", {
        skipped,
        error: message,
      });
    } finally {
      this.isTickRunning = false;
    }
  }

  private async startWorker() {
    const shouldRunImmediately = await this.recoverInterruptedJobs();
    const initialDelayMs = shouldRunImmediately ? 5_000 : 15_000;

    setTimeout(() => {
      void this.runTick();
    }, initialDelayMs).unref();
  }

  private async recoverInterruptedJobs() {
    const persistentState = await getAnalyticsJobState();
    const interruptedJobs = await prisma.fetchJobLog.findMany({
      where: {
        status: "running",
        jobName: {
          in: [
            "scheduler.full-refresh",
            "full-refresh",
            "seed-ranked-accounts",
            "update-stats",
            "analyze-global-stats",
          ],
        },
      },
      orderBy: {
        startedAt: "desc",
      },
    });

    if (interruptedJobs.length === 0 && persistentState?.status !== "running") {
      return false;
    }

    this.recoveredInterruptedRun = true;
    const recoveredAt = new Date();

    for (const job of interruptedJobs) {
      await prisma.fetchJobLog.update({
        where: {
          id: job.id,
        },
        data: {
          status: "failed",
          finishedAt: recoveredAt,
          durationMs: recoveredAt.getTime() - job.startedAt.getTime(),
          errorMessage: "Job interrupted by backend restart; scheduler will restart analytics cycle.",
          metadata: JSON.stringify({
            previousMetadata: parseMetadata(job.metadata),
            interruptedByRestart: true,
            recoveredAt: recoveredAt.toISOString(),
            restartAction: "restart-analytics-cycle",
          }),
        },
      });
    }

    logWarn("[scheduler] recovered interrupted analytics jobs", {
      count: interruptedJobs.length,
      persistentStateWasRunning: persistentState?.status === "running",
      restartAction: "restart-analytics-cycle",
    });

    await setAnalyticsJobState({
      status: "failed",
      currentStage: "failed",
      currentJob: "scheduler.full-refresh",
      errorMessage: "Analytics job interrupted by backend restart; scheduler will restart analytics cycle.",
      finishedAt: recoveredAt,
      metadata: {
        interruptedJobs: interruptedJobs.map((job) => ({
          jobName: job.jobName,
          startedAt: job.startedAt.toISOString(),
        })),
        previousPersistentState: persistentState
          ? {
              status: persistentState.status,
              currentStage: persistentState.currentStage,
              currentJob: persistentState.currentJob,
              progress: persistentState.progress,
            }
          : null,
        restartAction: "restart-analytics-cycle",
      },
    });

    return true;
  }

  private async updateSchedulerLog(
    logId: string,
    startedAt: Date,
    metadata: Record<string, unknown>,
  ) {
    await prisma.fetchJobLog.update({
      where: {
        id: logId,
      },
      data: {
        durationMs: Date.now() - startedAt.getTime(),
        metadata: JSON.stringify({
          trigger: "scheduler",
          intervalHours: backendConfig.statsUpdateIntervalHours,
          input: schedulerInput,
          recoveredInterruptedRun: this.recoveredInterruptedRun,
          ...metadata,
        }),
      },
    });
  }
}

export const statsScheduler = new StatsScheduler();

function parseMetadata(metadata: string | null) {
  if (!metadata) {
    return null;
  }

  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return metadata;
  }
}

async function findRunningAnalyticsJob() {
  return prisma.fetchJobLog.findFirst({
    where: {
      status: "running",
      jobName: {
        in: [
          "scheduler.full-refresh",
          "full-refresh",
          "seed-ranked-accounts",
          "update-stats",
          "analyze-global-stats",
        ],
      },
    },
    orderBy: {
      startedAt: "desc",
    },
  });
}
