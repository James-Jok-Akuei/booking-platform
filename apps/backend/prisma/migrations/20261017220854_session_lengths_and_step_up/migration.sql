-- How long a sign-in lasts, per app, and confirming it is you (§279).
--
-- Sign-ins that already exist are counted from now: their real start was never
-- recorded, and now is the kindest honest answer — nobody is signed out by the
-- migration itself.

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'STEP_UP';

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "sessionStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
