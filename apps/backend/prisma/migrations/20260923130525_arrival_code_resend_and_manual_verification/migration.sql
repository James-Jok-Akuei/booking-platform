-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('CODE', 'MANUAL');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_MANUALLY_VERIFIED';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "manualVerificationNote" TEXT,
ADD COLUMN     "verificationCode" TEXT,
ADD COLUMN     "verificationCodeSentCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "verificationMethod" "VerificationMethod",
ADD COLUMN     "verifiedById" TEXT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
