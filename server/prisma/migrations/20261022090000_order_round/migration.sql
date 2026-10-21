-- 공동구매 차수. 기존 주문은 모두 1차(경기인디뮤직페스티벌).
ALTER TABLE "Order" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
