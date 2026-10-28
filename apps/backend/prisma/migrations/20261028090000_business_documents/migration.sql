-- CreateEnum
CREATE TYPE "BusinessDocumentKind" AS ENUM ('RDB_CERTIFICATE', 'TIN_CERTIFICATE', 'TRADING_LICENCE', 'HEALTH_FACILITY_LICENCE', 'PROFESSIONAL_LICENCE', 'FDA_LICENCE', 'TOURISM_LICENCE', 'BAR_MEMBERSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "BusinessDocumentStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REFUSED', 'REPLACED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_DOCUMENT_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_DOCUMENT_VERIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_DOCUMENT_REFUSED';
ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_DOCUMENT_EXPIRING';

-- CreateTable
CREATE TABLE "business_documents" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "BusinessDocumentKind" NOT NULL,
    "label" TEXT,
    "number" TEXT,
    "expiresAt" TIMESTAMP(3),
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "BusinessDocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "refusalReason" TEXT,
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "reminderStage" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_documents_businessId_kind_status_idx" ON "business_documents"("businessId", "kind", "status");

-- CreateIndex
CREATE INDEX "business_documents_status_expiresAt_idx" ON "business_documents"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "business_documents" ADD CONSTRAINT "business_documents_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_documents" ADD CONSTRAINT "business_documents_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_documents" ADD CONSTRAINT "business_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

