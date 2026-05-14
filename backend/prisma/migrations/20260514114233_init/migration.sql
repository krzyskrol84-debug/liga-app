-- CreateTable
CREATE TABLE "PatchCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patch" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChampionStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patch" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "winRate" REAL NOT NULL,
    "pickRate" REAL NOT NULL,
    "banRate" REAL,
    "gamesCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RecommendationStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patch" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "label" TEXT,
    "primaryStyleId" INTEGER NOT NULL,
    "subStyleId" INTEGER NOT NULL,
    "selectedPerkIds" TEXT NOT NULL,
    "summonerSpellIds" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "winRate" REAL NOT NULL,
    "pickRate" REAL NOT NULL,
    "gamesCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ItemStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patch" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "itemSetKey" TEXT NOT NULL,
    "itemSetIds" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "winRate" REAL,
    "pickRate" REAL,
    "matches" INTEGER,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MatchupStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patch" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "opponentChampionId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "winRate" REAL NOT NULL,
    "gamesCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MatchRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "riotMatchId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "patch" TEXT,
    "queueId" INTEGER,
    "championId" INTEGER NOT NULL,
    "role" TEXT,
    "win" BOOLEAN NOT NULL,
    "kills" INTEGER,
    "deaths" INTEGER,
    "assists" INTEGER,
    "durationSeconds" INTEGER,
    "playedAt" DATETIME,
    "rawPayload" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FetchJobLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "recordsRead" INTEGER,
    "recordsSaved" INTEGER,
    "errorMessage" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PatchCache_patch_key" ON "PatchCache"("patch");

-- CreateIndex
CREATE INDEX "ChampionStats_patch_role_idx" ON "ChampionStats"("patch", "role");

-- CreateIndex
CREATE INDEX "ChampionStats_championId_role_idx" ON "ChampionStats"("championId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionStats_patch_championId_role_source_key" ON "ChampionStats"("patch", "championId", "role", "source");

-- CreateIndex
CREATE INDEX "RecommendationStats_patch_championId_role_idx" ON "RecommendationStats"("patch", "championId", "role");

-- CreateIndex
CREATE INDEX "RecommendationStats_source_fetchedAt_idx" ON "RecommendationStats"("source", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationStats_patch_championId_role_primaryStyleId_subStyleId_selectedPerkIds_summonerSpellIds_source_key" ON "RecommendationStats"("patch", "championId", "role", "primaryStyleId", "subStyleId", "selectedPerkIds", "summonerSpellIds", "source");

-- CreateIndex
CREATE INDEX "ItemStats_patch_championId_role_idx" ON "ItemStats"("patch", "championId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ItemStats_patch_championId_role_itemSetKey_source_key" ON "ItemStats"("patch", "championId", "role", "itemSetKey", "source");

-- CreateIndex
CREATE INDEX "MatchupStats_patch_championId_role_idx" ON "MatchupStats"("patch", "championId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "MatchupStats_patch_championId_opponentChampionId_role_source_key" ON "MatchupStats"("patch", "championId", "opponentChampionId", "role", "source");

-- CreateIndex
CREATE UNIQUE INDEX "MatchRecord_riotMatchId_key" ON "MatchRecord"("riotMatchId");

-- CreateIndex
CREATE INDEX "MatchRecord_puuid_playedAt_idx" ON "MatchRecord"("puuid", "playedAt");

-- CreateIndex
CREATE INDEX "MatchRecord_championId_role_idx" ON "MatchRecord"("championId", "role");

-- CreateIndex
CREATE INDEX "FetchJobLog_jobName_startedAt_idx" ON "FetchJobLog"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "FetchJobLog_status_startedAt_idx" ON "FetchJobLog"("status", "startedAt");
