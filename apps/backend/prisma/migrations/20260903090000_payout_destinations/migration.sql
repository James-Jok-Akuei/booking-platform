-- Payout destinations (§48).
--
-- Before this the platform could not pay anyone: a run produced a CSV with a
-- NOT RECORDED placeholder where the account number belongs (§47.2).
--
-- Sending money to an unverified number is the one mistake in this system that
-- cannot be undone by appending a correcting entry, so this table is an
-- append-only history rather than a mutable field on BusinessProfile.

CREATE TYPE "PayoutProvider" AS ENUM ('MTN_MOMO');
CREATE TYPE "PayoutDestinationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'SUPERSEDED');
CREATE TYPE "PayoutVerificationMethod" AS ENUM ('ADMIN', 'OTP');

CREATE TABLE "payout_destinations" (
  "id"                 TEXT NOT NULL,
  "businessId"         TEXT NOT NULL,
  "msisdn"             TEXT NOT NULL,
  "provider"           "PayoutProvider" NOT NULL DEFAULT 'MTN_MOMO',
  "status"             "PayoutDestinationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "submittedById"      TEXT NOT NULL,
  "submittedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedById"       TEXT,
  "verifiedAt"         TIMESTAMP(3),
  "verificationMethod" "PayoutVerificationMethod",
  -- Required for ADMIN verification. "verified" on its own is not a record
  -- anybody can audit six months later.
  "verificationNote"   TEXT,
  "rejectionReason"    TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payout_destinations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payout_destinations_businessId_status_idx"
  ON "payout_destinations"("businessId", "status");
-- The admin queue: unverified first, oldest first.
CREATE INDEX "payout_destinations_status_submittedAt_idx"
  ON "payout_destinations"("status", "submittedAt");

-- AT MOST ONE LIVE ROW PER BUSINESS.
--
-- Partial, exempting SUPERSEDED, so the history accumulates freely while only
-- one row is ever current. Exactly the pattern used for the single ACTIVE
-- membership (§15.2), and hand-written for the same reason: Prisma's DSL has no
-- WHERE clause for an index.
--
-- Enforced HERE and not only in the service, because two simultaneous
-- submissions would otherwise race into two live destinations — and "which
-- number does this business get paid at?" must have exactly one answer.
CREATE UNIQUE INDEX "payout_destinations_one_live_per_business"
  ON "payout_destinations"("businessId")
  WHERE "status" <> 'SUPERSEDED';

ALTER TABLE "payout_destinations"
  ADD CONSTRAINT "payout_destinations_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payout_destinations"
  ADD CONSTRAINT "payout_destinations_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull: losing the admin account must not lose the record of what was
-- verified and when.
ALTER TABLE "payout_destinations"
  ADD CONSTRAINT "payout_destinations_verifiedById_fkey"
  FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_DESTINATION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_DESTINATION_VERIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_DESTINATION_REJECTED';
