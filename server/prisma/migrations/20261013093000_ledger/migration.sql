-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "quantity" INTEGER,
    "memo" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "deletedBy" INTEGER
);

-- CreateIndex
CREATE INDEX "LedgerEntry_occurredAt_idx" ON "LedgerEntry"("occurredAt");

