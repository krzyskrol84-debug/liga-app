-- CreateTable
CREATE TABLE "AnalyticsJobState" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentStage" TEXT NOT NULL,
    "currentJob" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "processedMatches" INTEGER NOT NULL DEFAULT 0,
    "recommendationStatsAdded" INTEGER NOT NULL DEFAULT 0,
    "itemStatsAdded" INTEGER NOT NULL DEFAULT 0,
    "matchupStatsAdded" INTEGER NOT NULL DEFAULT 0,
    "currentChampion" TEXT,
    "currentRole" TEXT,
    "errorMessage" TEXT,
    "metadata" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastStatsUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsJobState_status_currentStage_idx" ON "AnalyticsJobState"("status", "currentStage");

-- CreateIndex
CREATE INDEX "AnalyticsJobState_updatedAt_idx" ON "AnalyticsJobState"("updatedAt");
