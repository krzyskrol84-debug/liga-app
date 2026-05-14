-- AlterTable
ALTER TABLE "TrackedAccount" ADD COLUMN "rankedTier" TEXT;

-- CreateIndex
CREATE INDEX "TrackedAccount_rankedTier_idx" ON "TrackedAccount"("rankedTier");
