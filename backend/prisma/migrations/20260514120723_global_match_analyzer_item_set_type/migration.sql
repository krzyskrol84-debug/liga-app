/*
  Warnings:

  - Added the required column `gamesCount` to the `ItemStats` table without a default value. This is not possible if the table is not empty.
  - Added the required column `itemSetType` to the `ItemStats` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ItemStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patch" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "itemSetType" TEXT NOT NULL,
    "itemSetKey" TEXT NOT NULL,
    "itemSetIds" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "winRate" REAL,
    "pickRate" REAL,
    "gamesCount" INTEGER NOT NULL,
    "matches" INTEGER,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ItemStats" ("championId", "createdAt", "fetchedAt", "id", "itemSetIds", "itemSetKey", "matches", "patch", "pickRate", "role", "source", "updatedAt", "winRate", "wins") SELECT "championId", "createdAt", "fetchedAt", "id", "itemSetIds", "itemSetKey", "matches", "patch", "pickRate", "role", "source", "updatedAt", "winRate", "wins" FROM "ItemStats";
DROP TABLE "ItemStats";
ALTER TABLE "new_ItemStats" RENAME TO "ItemStats";
CREATE INDEX "ItemStats_patch_championId_role_idx" ON "ItemStats"("patch", "championId", "role");
CREATE UNIQUE INDEX "ItemStats_patch_championId_role_itemSetType_itemSetKey_source_key" ON "ItemStats"("patch", "championId", "role", "itemSetType", "itemSetKey", "source");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
