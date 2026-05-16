import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";

const GLOBAL_JOB_LOCK_ID = "global";
const GLOBAL_JOB_CHECKPOINT_ID = "global";

export class PersistentJobLockError extends Error {
  constructor(jobName: string) {
    super(`${jobName} cannot start because another backend job is active.`);
    this.name = "PersistentJobLockError";
  }
}

export async function acquirePersistentJobLock(jobName: string, metadata?: unknown) {
  const ownerId = randomUUID();
  const existing = await prisma.jobLock.findUnique({
    where: { id: GLOBAL_JOB_LOCK_ID },
  });
  if (existing?.jobName === jobName) {
    return prisma.jobLock.update({
      where: { id: GLOBAL_JOB_LOCK_ID },
      data: {
        ownerId,
        heartbeatAt: new Date(),
        ...(metadata === undefined ? {} : { metadata: serialize(metadata) }),
      },
    });
  }

  try {
    return await prisma.jobLock.create({
      data: {
        id: GLOBAL_JOB_LOCK_ID,
        jobName,
        ownerId,
        metadata: serialize(metadata),
      },
    });
  } catch {
    throw new PersistentJobLockError(jobName);
  }
}

export async function heartbeatPersistentJobLock(metadata?: unknown) {
  await prisma.jobLock.updateMany({
    where: { id: GLOBAL_JOB_LOCK_ID },
    data: {
      heartbeatAt: new Date(),
      ...(metadata === undefined ? {} : { metadata: serialize(metadata) }),
    },
  });
}

export async function releasePersistentJobLock() {
  await prisma.jobLock.deleteMany({
    where: { id: GLOBAL_JOB_LOCK_ID },
  });
}

export async function getPersistentJobLock() {
  return prisma.jobLock.findUnique({
    where: { id: GLOBAL_JOB_LOCK_ID },
  });
}

export async function saveJobCheckpoint(input: {
  jobName: string;
  currentStage?: string | null;
  currentAccountId?: string | null;
  currentMatchId?: string | null;
  cursorId?: string | null;
  progress?: number;
  metadata?: unknown;
}) {
  return prisma.jobCheckpoint.upsert({
    where: { id: GLOBAL_JOB_CHECKPOINT_ID },
    create: {
      id: GLOBAL_JOB_CHECKPOINT_ID,
      jobName: input.jobName,
      currentStage: input.currentStage ?? null,
      currentAccountId: input.currentAccountId ?? null,
      currentMatchId: input.currentMatchId ?? null,
      cursorId: input.cursorId ?? null,
      progress: clampProgress(input.progress ?? 0),
      metadata: serialize(input.metadata),
    },
    update: {
      jobName: input.jobName,
      currentStage: input.currentStage,
      currentAccountId: input.currentAccountId,
      currentMatchId: input.currentMatchId,
      cursorId: input.cursorId,
      progress: input.progress === undefined ? undefined : clampProgress(input.progress),
      metadata: input.metadata === undefined ? undefined : serialize(input.metadata),
    },
  });
}

export async function getJobCheckpoint() {
  return prisma.jobCheckpoint.findUnique({
    where: { id: GLOBAL_JOB_CHECKPOINT_ID },
  });
}

export async function incrementJobRestartCount() {
  return prisma.jobCheckpoint.updateMany({
    where: { id: GLOBAL_JOB_CHECKPOINT_ID },
    data: {
      restartCount: {
        increment: 1,
      },
    },
  });
}

export async function clearJobCheckpoint() {
  await prisma.jobCheckpoint.deleteMany({
    where: { id: GLOBAL_JOB_CHECKPOINT_ID },
  });
}

export async function hasPersistentJobLock() {
  return Boolean(await getPersistentJobLock());
}

export function parseJobMetadata(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function clampProgress(progress: number) {
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function serialize(value: unknown) {
  return value === undefined ? undefined : JSON.stringify(value);
}
