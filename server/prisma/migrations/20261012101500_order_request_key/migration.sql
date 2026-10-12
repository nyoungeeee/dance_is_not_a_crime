-- AlterTable
ALTER TABLE "Order" ADD COLUMN "requestKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_requestKey_key" ON "Order"("requestKey");

