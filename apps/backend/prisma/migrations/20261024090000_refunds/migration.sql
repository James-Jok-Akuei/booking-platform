-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('SHOP_CANCELLED', 'CANCELLED_IN_TIME');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "paymentPhoneNumber" TEXT;

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "provider" "MobileMoneyProvider",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerReferenceId" TEXT,
    "reference" TEXT,
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_appointmentId_key" ON "refunds"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_providerReferenceId_key" ON "refunds"("providerReferenceId");

-- CreateIndex
CREATE INDEX "refunds_status_createdAt_idx" ON "refunds"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

