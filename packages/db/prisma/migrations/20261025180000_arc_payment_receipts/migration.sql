BEGIN;

-- CreateEnum
CREATE TYPE "ArcPaymentStatus" AS ENUM ('PREPARED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ArcPaymentKind" AS ENUM ('SALARY', 'REFUND');

-- AlterTable
ALTER TABLE "SalaryRelease" ADD COLUMN     "arcPaymentItemId" TEXT;

-- CreateTable
CREATE TABLE "ArcPaymentIntent" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 5042002,
    "contractAddress" TEXT NOT NULL,
    "employerWallet" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "totalNative" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "status" "ArcPaymentStatus" NOT NULL DEFAULT 'PREPARED',
    "txHash" TEXT,
    "submittedTxHash" TEXT,
    "receiptBlockNumber" TEXT,
    "receiptBlockHash" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArcPaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArcPaymentItem" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "ArcPaymentKind" NOT NULL,
    "recipient" TEXT NOT NULL,
    "amountBusiness" TEXT NOT NULL,
    "amountNative" TEXT NOT NULL,
    "checkInId" TEXT,
    "refundRequestId" TEXT,

    CONSTRAINT "ArcPaymentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArcPaymentIntent_runId_key" ON "ArcPaymentIntent"("runId");

-- CreateIndex
CREATE INDEX "ArcPaymentIntent_employerId_createdAt_idx" ON "ArcPaymentIntent"("employerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArcPaymentIntent_chainId_txHash_key" ON "ArcPaymentIntent"("chainId", "txHash");

-- CreateIndex
CREATE UNIQUE INDEX "ArcPaymentItem_checkInId_key" ON "ArcPaymentItem"("checkInId");

-- CreateIndex
CREATE UNIQUE INDEX "ArcPaymentItem_refundRequestId_key" ON "ArcPaymentItem"("refundRequestId");

-- CreateIndex
CREATE INDEX "ArcPaymentItem_employeeId_kind_idx" ON "ArcPaymentItem"("employeeId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRelease_arcPaymentItemId_key" ON "SalaryRelease"("arcPaymentItemId");

-- AddForeignKey
ALTER TABLE "SalaryRelease" ADD CONSTRAINT "SalaryRelease_arcPaymentItemId_fkey" FOREIGN KEY ("arcPaymentItemId") REFERENCES "ArcPaymentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcPaymentIntent" ADD CONSTRAINT "ArcPaymentIntent_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcPaymentItem" ADD CONSTRAINT "ArcPaymentItem_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "ArcPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcPaymentItem" ADD CONSTRAINT "ArcPaymentItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcPaymentItem" ADD CONSTRAINT "ArcPaymentItem_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcPaymentItem" ADD CONSTRAINT "ArcPaymentItem_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Each frozen obligation has exactly one source of the matching kind.
ALTER TABLE "ArcPaymentItem" ADD CONSTRAINT "ArcPaymentItem_source_kind_check" CHECK (
  ("kind" = 'SALARY' AND "checkInId" IS NOT NULL AND "refundRequestId" IS NULL) OR
  ("kind" = 'REFUND' AND "refundRequestId" IS NOT NULL AND "checkInId" IS NULL)
);
-- A recovery hint cannot substitute for finalized receipt evidence.
ALTER TABLE "ArcPaymentIntent" ADD CONSTRAINT "ArcPaymentIntent_receipt_status_check" CHECK (
  ("status" = 'PREPARED' AND "txHash" IS NULL AND "verifiedAt" IS NULL AND "receiptBlockNumber" IS NULL AND "receiptBlockHash" IS NULL) OR
  ("status" = 'CONFIRMED' AND "txHash" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "receiptBlockNumber" IS NOT NULL AND "receiptBlockHash" IS NOT NULL)
);

COMMIT;
