ALTER TABLE "MatchRecord"
  ALTER COLUMN "rawPayload" DROP NOT NULL,
  ADD COLUMN "compactPayload" TEXT,
  ADD COLUMN "payloadFormat" TEXT NOT NULL DEFAULT 'full-json';

CREATE INDEX "MatchRecord_payloadFormat_idx" ON "MatchRecord"("payloadFormat");
