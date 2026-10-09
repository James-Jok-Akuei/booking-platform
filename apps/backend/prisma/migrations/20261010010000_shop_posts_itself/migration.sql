-- A shop posts itself for customers to see once it is approved (§268).
--
-- Approval used to make a shop public at once; the seller found out from their
-- first booking. `publishedAt` is when the shop pressed "Post my shop" — a shop
-- is public only when it is approved, posted, and not paused.

ALTER TABLE "business_profiles" ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Every shop that is approved now, or was before a suspension, has already
-- been public under the old rule. It stays as it was: nobody is taken out of
-- the app by this change.
UPDATE "business_profiles"
SET "publishedAt" = COALESCE("statusChangedAt", "updatedAt")
WHERE "status" IN ('APPROVED', 'SUSPENDED');
