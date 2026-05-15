ALTER TABLE "MatchRecord"
  ADD COLUMN "analyzedAt" TIMESTAMP(3),
  ADD COLUMN "compactedAt" TIMESTAMP(3);

CREATE INDEX "MatchRecord_analyzedAt_idx" ON "MatchRecord"("analyzedAt");
CREATE INDEX "MatchRecord_compactedAt_idx" ON "MatchRecord"("compactedAt");
