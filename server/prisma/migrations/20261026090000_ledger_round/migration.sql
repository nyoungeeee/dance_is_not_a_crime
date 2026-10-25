-- 정산 내역의 차수. 1차 마감(10/13) 다음 날부터 적은 내역은 2차(세종)로 본다.
ALTER TABLE "LedgerEntry" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
UPDATE "LedgerEntry" SET "round" = 2 WHERE "occurredAt" >= '2026-10-14T15:00:00';
