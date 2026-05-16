import { prisma } from "../lib/prisma.js";
import { assertNoRunningJob } from "../lib/jobGuards.js";

export type CleanupRawPayloadsResult = {
  ok: true;
  rawPayloadsCleaned: number;
};

export class CleanupRawPayloadsJob {
  async run(_options: { nested?: boolean } = {}): Promise<CleanupRawPayloadsResult> {
    await assertNoRunningJob("cleanup-raw-payloads");
    const startedAt = new Date();
    const jobLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "cleanup-raw-payloads",
        status: "running",
        target: "match-records",
        startedAt,
      },
    });

    try {
      const result = await prisma.matchRecord.updateMany({
        where: {
          analyzedAt: {
            not: null,
          },
          compactPayload: {
            not: null,
          },
          rawPayload: {
            not: null,
          },
        },
        data: {
          rawPayload: null,
        },
      });
      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: { id: jobLog.id },
        data: {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          recordsRead: result.count,
          recordsSaved: result.count,
          metadata: JSON.stringify({
            rawPayloadsCleaned: result.count,
          }),
        },
      });

      return {
        ok: true,
        rawPayloadsCleaned: result.count,
      };
    } catch (error) {
      await prisma.fetchJobLog.update({
        where: { id: jobLog.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }
}

export const cleanupRawPayloadsJob = new CleanupRawPayloadsJob();
