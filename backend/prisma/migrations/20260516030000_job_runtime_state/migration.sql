CREATE TABLE "JobLock" (
  "id" TEXT NOT NULL,
  "jobName" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobCheckpoint" (
  "id" TEXT NOT NULL,
  "jobName" TEXT NOT NULL,
  "currentStage" TEXT,
  "currentAccountId" TEXT,
  "currentMatchId" TEXT,
  "cursorId" TEXT,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "restartCount" INTEGER NOT NULL DEFAULT 0,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobLock_jobName_idx" ON "JobLock"("jobName");
CREATE INDEX "JobLock_heartbeatAt_idx" ON "JobLock"("heartbeatAt");
CREATE INDEX "JobCheckpoint_jobName_idx" ON "JobCheckpoint"("jobName");
CREATE INDEX "JobCheckpoint_updatedAt_idx" ON "JobCheckpoint"("updatedAt");
