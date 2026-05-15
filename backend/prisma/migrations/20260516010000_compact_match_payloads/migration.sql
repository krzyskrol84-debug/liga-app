ALTER TABLE "MatchRecord"
  ADD COLUMN "compactPayload" TEXT,
  ADD COLUMN "payloadFormat" TEXT;

CREATE INDEX "MatchRecord_payloadFormat_idx" ON "MatchRecord"("payloadFormat");
