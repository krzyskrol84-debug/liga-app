import { prisma } from "./prisma.js";

export class ConcurrentJobError extends Error {
  constructor(jobName: string) {
    super(`${jobName} is already running.`);
    this.name = "ConcurrentJobError";
  }
}

export async function assertNoRunningJob(jobName: string) {
  const running = await prisma.fetchJobLog.findFirst({
    where: {
      jobName,
      status: "running",
    },
    orderBy: {
      startedAt: "desc",
    },
  });

  if (running) {
    throw new ConcurrentJobError(jobName);
  }
}
