-- Test accounts (§316): the console's statistics leave out our own test
-- accounts and the demo's, so the numbers the team pitches with are real.

ALTER TABLE "users"
  ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "testMarkedAt" TIMESTAMP(3),
  ADD COLUMN "testMarkedBy" TEXT;

ALTER TABLE "business_profiles"
  ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "testMarkedAt" TIMESTAMP(3),
  ADD COLUMN "testMarkedBy" TEXT;

-- Every figure about bookings is counted by the day its deposit was paid.
CREATE INDEX "appointments_depositPaidAt_idx" ON "appointments"("depositPaidAt");

-- An address no real person can hold — the reserved example domains and
-- top-level names (RFC 2606) — is a test account. Not ".invalid": that is
-- where a CLOSED account's address goes (§122), and those were real people.
UPDATE "users"
SET "isTest" = true, "testMarkedAt" = now(), "testMarkedBy" = 'automatic'
WHERE lower(split_part("email", '@', 2)) IN ('example.com', 'example.net', 'example.org')
   OR lower("email") ~ '\.(test|example|localhost)$';

-- A shop whose owner is a test account is a test shop.
UPDATE "business_profiles" b
SET "isTest" = true, "testMarkedAt" = now(), "testMarkedBy" = 'automatic'
WHERE EXISTS (
  SELECT 1
  FROM "business_memberships" m
  JOIN "users" u ON u."id" = m."userId"
  WHERE m."businessProfileId" = b."id"
    AND m."role" = 'OWNER'
    AND u."isTest"
);
