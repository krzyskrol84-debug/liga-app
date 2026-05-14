-- CreateTable
CREATE TABLE "TrackedAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameName" TEXT NOT NULL,
    "tagLine" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "platformRegion" TEXT NOT NULL,
    "routingRegion" TEXT NOT NULL,
    "lastFetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedAccount_puuid_key" ON "TrackedAccount"("puuid");

-- CreateIndex
CREATE INDEX "TrackedAccount_platformRegion_routingRegion_idx" ON "TrackedAccount"("platformRegion", "routingRegion");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedAccount_gameName_tagLine_platformRegion_routingRegion_key" ON "TrackedAccount"("gameName", "tagLine", "platformRegion", "routingRegion");
