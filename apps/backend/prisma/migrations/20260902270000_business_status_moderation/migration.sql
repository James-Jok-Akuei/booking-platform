-- Business approval (§42).
--
-- BusinessStatus already gated every public read, but nothing could set it: a
-- business could only be approved by editing the database by hand, which left
-- every public surface unreachable in practice.

-- One reason field for whichever state the row is actually in, replacing a
-- field that could only ever describe one of the four.
ALTER TABLE "business_profiles" ADD COLUMN "statusReason" TEXT;
ALTER TABLE "business_profiles" ADD COLUMN "statusChangedAt" TIMESTAMP(3);
ALTER TABLE "business_profiles" ADD COLUMN "statusChangedById" TEXT;

-- Carry the existing rejections across before the column goes. A rejection
-- reason is the only thing a rejected applicant has been told, so losing it
-- would leave them with a refusal and no explanation.
UPDATE "business_profiles"
   SET "statusReason" = "rejectionReason"
 WHERE "rejectionReason" IS NOT NULL;

ALTER TABLE "business_profiles" DROP COLUMN "rejectionReason";

-- SetNull: losing the admin account must not lose the moderation record.
ALTER TABLE "business_profiles"
  ADD CONSTRAINT "business_profiles_statusChangedById_fkey"
  FOREIGN KEY ("statusChangedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_REINSTATED';
