-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_KIND_WRITTEN';

-- AlterTable
ALTER TABLE "business_kinds" ADD COLUMN     "otherLabel" TEXT;
