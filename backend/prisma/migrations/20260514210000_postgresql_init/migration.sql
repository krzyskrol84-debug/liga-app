-- CreateTable
CREATE TABLE "PatchCache" (
    "id" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatchCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChampionStats" (
    "id" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "pickRate" DOUBLE PRECISION NOT NULL,
    "banRate" DOUBLE PRECISION,
    "gamesCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChampionStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationStats" (
    "id" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "label" TEXT,
    "primaryStyleId" INTEGER NOT NULL,
    "subStyleId" INTEGER NOT NULL,
    "selectedPerkIds" TEXT NOT NULL,
    "summonerSpellIds" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "pickRate" DOUBLE PRECISION NOT NULL,
    "gamesCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemStats" (
    "id" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "itemSetType" TEXT NOT NULL,
    "itemSetKey" TEXT NOT NULL,
    "itemSetIds" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION,
    "pickRate" DOUBLE PRECISION,
    "gamesCount" INTEGER NOT NULL,
    "matches" INTEGER,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchupStats" (
    "id" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "opponentChampionId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "gamesCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchupStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchRecord" (
    "id" TEXT NOT NULL,
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
    "playedAt" TIMESTAMP(3),
    "rawPayload" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedAccount" (
    "id" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "tagLine" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "platformRegion" TEXT NOT NULL,
    "routingRegion" TEXT NOT NULL,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FetchJobLog" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "recordsRead" INTEGER,
    "recordsSaved" INTEGER,
    "errorMessage" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FetchJobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatchCache_patch_key" ON "PatchCache"("patch");

-- CreateIndex
CREATE INDEX "ChampionStats_patch_role_idx" ON "ChampionStats"("patch", "role");

-- CreateIndex
CREATE INDEX "ChampionStats_championId_role_idx" ON "ChampionStats"("championId", "role");

-- CreateIndex
CREATE INDEX "ChampionStats_source_patch_championId_role_idx" ON "ChampionStats"("source", "patch", "championId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionStats_patch_championId_role_source_key" ON "ChampionStats"("patch", "championId", "role", "source");

-- CreateIndex
CREATE INDEX "RecommendationStats_patch_championId_role_idx" ON "RecommendationStats"("patch", "championId", "role");

-- CreateIndex
CREATE INDEX "RecommendationStats_source_fetchedAt_idx" ON "RecommendationStats"("source", "fetchedAt");

-- CreateIndex
CREATE INDEX "RecommendationStats_source_patch_championId_role_idx" ON "RecommendationStats"("source", "patch", "championId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationStats_patch_championId_role_primaryStyleId_subStyleId_selectedPerkIds_summonerSpellIds_source_key" ON "RecommendationStats"("patch", "championId", "role", "primaryStyleId", "subStyleId", "selectedPerkIds", "summonerSpellIds", "source");

-- CreateIndex
CREATE INDEX "ItemStats_patch_championId_role_idx" ON "ItemStats"("patch", "championId", "role");

-- CreateIndex
CREATE INDEX "ItemStats_source_patch_championId_role_itemSetType_idx" ON "ItemStats"("source", "patch", "championId", "role", "itemSetType");

-- CreateIndex
CREATE UNIQUE INDEX "ItemStats_patch_championId_role_itemSetType_itemSetKey_source_key" ON "ItemStats"("patch", "championId", "role", "itemSetType", "itemSetKey", "source");

-- CreateIndex
CREATE INDEX "MatchupStats_patch_championId_role_idx" ON "MatchupStats"("patch", "championId", "role");

-- CreateIndex
CREATE INDEX "MatchupStats_source_patch_championId_role_idx" ON "MatchupStats"("source", "patch", "championId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "MatchupStats_patch_championId_opponentChampionId_role_source_key" ON "MatchupStats"("patch", "championId", "opponentChampionId", "role", "source");

-- CreateIndex
CREATE UNIQUE INDEX "MatchRecord_riotMatchId_key" ON "MatchRecord"("riotMatchId");

-- CreateIndex
CREATE INDEX "MatchRecord_puuid_playedAt_idx" ON "MatchRecord"("puuid", "playedAt");

-- CreateIndex
CREATE INDEX "MatchRecord_championId_role_idx" ON "MatchRecord"("championId", "role");

-- CreateIndex
CREATE INDEX "MatchRecord_puuid_idx" ON "MatchRecord"("puuid");

-- CreateIndex
CREATE INDEX "MatchRecord_patch_idx" ON "MatchRecord"("patch");

-- CreateIndex
CREATE INDEX "MatchRecord_role_idx" ON "MatchRecord"("role");

-- CreateIndex
CREATE INDEX "MatchRecord_patch_championId_role_idx" ON "MatchRecord"("patch", "championId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedAccount_puuid_key" ON "TrackedAccount"("puuid");

-- CreateIndex
CREATE INDEX "TrackedAccount_platformRegion_routingRegion_idx" ON "TrackedAccount"("platformRegion", "routingRegion");

-- CreateIndex
CREATE INDEX "TrackedAccount_lastFetchedAt_idx" ON "TrackedAccount"("lastFetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedAccount_gameName_tagLine_platformRegion_routingRegion_key" ON "TrackedAccount"("gameName", "tagLine", "platformRegion", "routingRegion");

-- CreateIndex
CREATE INDEX "FetchJobLog_jobName_startedAt_idx" ON "FetchJobLog"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "FetchJobLog_status_startedAt_idx" ON "FetchJobLog"("status", "startedAt");
