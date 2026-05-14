import { backendConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
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

  start() {
    if (!backendConfig.enableScheduler || this.timer) {
      return;
    }

    const intervalMs = backendConfig.statsUpdateIntervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.runTick();
    }, intervalMs);
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
        }),
      },
    });

    try {
      const result = await fullRefreshJob.run(schedulerInput);
      await prisma.fetchJobLog.update({
        where: {
          id: log.id,
        },
        data: {
          status: "completed",
          finishedAt: new Date(),
          durationMs: result.summary.durationMs,
          recordsSaved: result.summary.fetchedMatches,
          metadata: JSON.stringify(result.summary),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scheduler full-refresh error";
      await prisma.fetchJobLog.update({
        where: {
          id: log.id,
        },
        data: {
          status: error instanceof FullRefreshAlreadyRunningError ? "completed" : "failed",
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          errorMessage: message,
          metadata: JSON.stringify({
            skipped: error instanceof FullRefreshAlreadyRunningError,
            trigger: "scheduler",
          }),
        },
      });
    } finally {
      this.isTickRunning = false;
    }
  }
}

export const statsScheduler = new StatsScheduler();
