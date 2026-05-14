-- CreateTable
CREATE TABLE "RiotMatchFetchQueue" (
    "id" TEXT NOT NULL,
    "riotMatchId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "platformRegion" TEXT,
    "routingRegion" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiotMatchFetchQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiotMatchFetchQueue_riotMatchId_key" ON "RiotMatchFetchQueue"("riotMatchId");

-- CreateIndex
CREATE INDEX "RiotMatchFetchQueue_status_priority_nextAttemptAt_idx" ON "RiotMatchFetchQueue"("status", "priority", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "RiotMatchFetchQueue_puuid_status_idx" ON "RiotMatchFetchQueue"("puuid", "status");

-- CreateIndex
CREATE INDEX "RiotMatchFetchQueue_routingRegion_status_idx" ON "RiotMatchFetchQueue"("routingRegion", "status");

-- CreateIndex
CREATE INDEX "RiotMatchFetchQueue_updatedAt_idx" ON "RiotMatchFetchQueue"("updatedAt");
