import { prisma } from "../lib/prisma.js";
import { compactStoredPayload } from "../lib/matchPayload.js";
import { logInfo } from "../lib/logger.js";
import { assertNoRunningJob } from "../lib/jobGuards.js";
import {
  acquirePersistentJobLock,
  clearJobCheckpoint,
  getJobCheckpoint,
  heartbeatPersistentJobLock,
  releasePersistentJobLock,
  saveJobCheckpoint,
} from "../lib/jobRuntime.js";

const DEFAULT_BATCH_SIZE = 25;
const MIN_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 500;

export type CompactMatchRecordsResult = {
  ok: true;
  recordsRead: number;
  recordsCompacted: number;
  recordsSkipped: number;
  rawBytesBefore: number;
  compactBytesAfter: number;
};

export class CompactMatchRecordsJob {
  async run(
    batchSize = DEFAULT_BATCH_SIZE,
    options: { nested?: boolean; checkpointJobName?: string } = {},
  ): Promise<CompactMatchRecordsResult> {
    await assertNoRunningJob("compact-match-records");
    if (!options.nested) {
      await acquirePersistentJobLock("compact-match-records");
    }
    const normalizedBatchSize = normalizeBatchSize(batchSize);
    const startedAt = new Date();
    const jobLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "compact-match-records",
        status: "running",
        target: "match-records",
        startedAt,
      },
    });

    const checkpointJobName = options.checkpointJobName ?? "compact-match-records";
    let completed = false;
    let recordsRead = 0;
    let recordsCompacted = 0;
    let recordsSkipped = 0;
    let rawBytesBefore = 0;
    let compactBytesAfter = 0;
    const checkpoint = await getJobCheckpoint();
    let cursorId =
      checkpoint?.jobName === checkpointJobName ? checkpoint.cursorId ?? undefined : undefined;

    try {
      while (true) {
        const records = await prisma.matchRecord.findMany({
          take: normalizedBatchSize,
          where: {
            analyzedAt: {
              not: null,
            },
          },
          ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
          orderBy: { id: "asc" },
          select: {
            id: true,
            riotMatchId: true,
            rawPayload: true,
            compactPayload: true,
            compactedAt: true,
          },
        });

        if (records.length === 0) {
          break;
        }

        for (const record of records) {
          recordsRead += 1;
          cursorId = record.id;

          if (record.compactPayload) {
            if (!record.compactedAt) {
              await prisma.matchRecord.update({
                where: { id: record.id },
                data: {
                  compactedAt: new Date(),
                },
              });
            }
            recordsSkipped += 1;
            continue;
          }

          const compactPayload = compactStoredPayload(record.riotMatchId, record.rawPayload);
          if (!compactPayload) {
            recordsSkipped += 1;
            continue;
          }

          rawBytesBefore += Buffer.byteLength(record.rawPayload ?? "", "utf8");
          compactBytesAfter += Buffer.byteLength(compactPayload, "utf8");

          await prisma.matchRecord.update({
            where: { id: record.id },
            data: {
              compactPayload,
              rawPayload: null,
              payloadFormat: "compact-json-v1",
              compactedAt: new Date(),
            },
          });
          recordsCompacted += 1;
        }

        logInfo("[db] compact-match-records batch completed", {
          recordsRead,
          recordsCompacted,
          recordsSkipped,
        });
        await saveJobCheckpoint({
          jobName: checkpointJobName,
          currentStage: "compacting-matches",
          cursorId,
          currentMatchId: records.at(-1)?.riotMatchId ?? null,
          progress: 0,
          metadata: {
            recordsRead,
            recordsCompacted,
            recordsSkipped,
          },
        });
        await heartbeatPersistentJobLock({
          currentStage: "compacting-matches",
          cursorId,
        });
      }

      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: { id: jobLog.id },
        data: {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          recordsRead,
          recordsSaved: recordsCompacted,
          metadata: JSON.stringify({
            recordsSkipped,
            rawBytesBefore,
            compactBytesAfter,
            bytesSavedEstimate: rawBytesBefore - compactBytesAfter,
          }),
        },
      });

      completed = true;
      return {
        ok: true,
        recordsRead,
        recordsCompacted,
        recordsSkipped,
        rawBytesBefore,
        compactBytesAfter,
      };
    } catch (error) {
      await prisma.fetchJobLog.update({
        where: { id: jobLog.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          errorMessage: getSafeErrorMessage(error),
        },
      });
      if (!options.nested) {
        await releasePersistentJobLock();
      }
      throw error;
    } finally {
      if (!options.nested && completed) {
        await clearJobCheckpoint();
        await releasePersistentJobLock();
      }
    }
  }
}

export const compactMatchRecordsJob = new CompactMatchRecordsJob();

function getSafeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeBatchSize(batchSize: number) {
  if (!Number.isInteger(batchSize)) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, batchSize));
}
