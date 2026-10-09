-- A shop sends itself for review once it is ready, and can send itself back
-- after a rejection (§255).
--
-- `submittedAt` is when the shop last asked to be reviewed: the admin queue is
-- the shops that have asked, not every account that ever signed up, and the
-- moment it is set is when administrators are told. `lastRejectionReason`
-- keeps what the last rejection said once the shop has fixed things and sent
-- itself back — `statusReason` describes the CURRENT status, and a shop
-- waiting again is no longer rejected.

ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_SUBMITTED';

ALTER TABLE "business_profiles"
    ADD COLUMN "submittedAt" TIMESTAMP(3),
    ADD COLUMN "lastRejectionReason" TEXT;

-- Every shop that already gave its name had applied under the old rule, where
-- signing up WAS applying; keep them in the queue they were already in.
UPDATE "business_profiles" SET "submittedAt" = "createdAt" WHERE "name" IS NOT NULL;
UPDATE "business_profiles" SET "lastRejectionReason" = "statusReason" WHERE "status" = 'REJECTED';

CREATE INDEX "business_profiles_status_submittedAt_idx" ON "business_profiles"("status", "submittedAt");
