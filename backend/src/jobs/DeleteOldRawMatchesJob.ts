import { prisma } from "../lib/prisma.js";
import { compactStoredPayload } from "../lib/matchPayload.js";
import { assertNoRunningJob } from "../lib/jobGuards.js";

const BATCH_SIZE = 250;

export type DeleteOldRawMatchesInput = {
  olderThanDays: number;
};

export type DeleteOldRawMatchesResult = {
  ok: true;
  cutoff: string;
  recordsRead: number;
  rawPayloadsDeleted: number;
  recordsCompactedBeforeDelete: number;
  recordsSkipped: number;
};

export class DeleteOldRawMatchesJob {
  async run(input: DeleteOldRawMatchesInput): Promise<DeleteOldRawMatchesResult> {
    await assertNoRunningJob("delete-old-raw-matches");
    const startedAt = new Date();
    const cutoff = new Date(Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000);
    const jobLog = await prisma.fetchJobLog.create({
      data: {
        jobName: "delete-old-raw-matches",
        status: "running",
        target: "match-records",
        startedAt,
        metadata: JSON.stringify({
          olderThanDays: input.olderThanDays,
          cutoff: cutoff.toISOString(),
        }),
      },
    });

    let recordsRead = 0;
    let rawPayloadsDeleted = 0;
    let recordsCompactedBeforeDelete = 0;
    let recordsSkipped = 0;
    let cursorId: string | undefined;

    try {
      while (true) {
        const records = await prisma.matchRecord.findMany({
          take: BATCH_SIZE,
          where: {
            rawPayload: {
              not: null,
            },
            analyzedAt: {
              not: null,
            },
            fetchedAt: {
              lt: cutoff,
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
          const compactPayload =
            record.compactPayload ?? compactStoredPayload(record.riotMatchId, record.rawPayload);

          if (!compactPayload) {
            recordsSkipped += 1;
            continue;
          }

          await prisma.matchRecord.update({
            where: { id: record.id },
            data: {
              compactPayload,
              rawPayload: null,
              payloadFormat: "compact-json-v1",
              compactedAt: record.compactedAt ?? new Date(),
            },
          });

          if (!record.compactPayload) {
            recordsCompactedBeforeDelete += 1;
          }
          rawPayloadsDeleted += 1;
        }
      }

      const finishedAt = new Date();
      await prisma.fetchJobLog.update({
        where: { id: jobLog.id },
        data: {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          recordsRead,
          recordsSaved: rawPayloadsDeleted,
          metadata: JSON.stringify({
            olderThanDays: input.olderThanDays,
            cutoff: cutoff.toISOString(),
            rawPayloadsDeleted,
            recordsCompactedBeforeDelete,
            recordsSkipped,
          }),
        },
      });

      return {
        ok: true,
        cutoff: cutoff.toISOString(),
        recordsRead,
        rawPayloadsDeleted,
        recordsCompactedBeforeDelete,
        recordsSkipped,
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
      throw error;
    }
  }
}

export const deleteOldRawMatchesJob = new DeleteOldRawMatchesJob();

function getSafeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
