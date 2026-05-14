-- CreateIndex
CREATE INDEX "ChampionStats_source_patch_championId_role_idx" ON "ChampionStats"("source", "patch", "championId", "role");

-- CreateIndex
CREATE INDEX "ItemStats_source_patch_championId_role_itemSetType_idx" ON "ItemStats"("source", "patch", "championId", "role", "itemSetType");

-- CreateIndex
CREATE INDEX "MatchRecord_puuid_idx" ON "MatchRecord"("puuid");

-- CreateIndex
CREATE INDEX "MatchRecord_patch_idx" ON "MatchRecord"("patch");

-- CreateIndex
CREATE INDEX "MatchRecord_role_idx" ON "MatchRecord"("role");

-- CreateIndex
CREATE INDEX "MatchRecord_patch_championId_role_idx" ON "MatchRecord"("patch", "championId", "role");

-- CreateIndex
CREATE INDEX "MatchupStats_source_patch_championId_role_idx" ON "MatchupStats"("source", "patch", "championId", "role");

-- CreateIndex
CREATE INDEX "RecommendationStats_source_patch_championId_role_idx" ON "RecommendationStats"("source", "patch", "championId", "role");

-- CreateIndex
CREATE INDEX "TrackedAccount_lastFetchedAt_idx" ON "TrackedAccount"("lastFetchedAt");
