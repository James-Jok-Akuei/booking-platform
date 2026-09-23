-- Which mobile money operator took each payment (§57).
--
-- WRITTEN BY HAND. Prisma sees an enum rename as drop-and-recreate, which would
-- take every payout destination's provider with it.

-- ---------------------------------------------------------------------------
-- One enum for the operator, in either direction
-- ---------------------------------------------------------------------------
-- "PayoutProvider" named the direction rather than the thing. It was only about
-- payouts because payouts were the only place the operator was recorded; a
-- payment now records it too, and it is the same set of companies.
ALTER TYPE "PayoutProvider" RENAME TO "MobileMoneyProvider";

ALTER TYPE "MobileMoneyProvider" ADD VALUE 'AIRTEL_MONEY';

-- ---------------------------------------------------------------------------
-- The operator that holds each payment reference
-- ---------------------------------------------------------------------------
ALTER TABLE "appointments" ADD COLUMN "paymentProvider" "MobileMoneyProvider";

-- Backfill, deliberately — and unlike §33, which refused to.
--
-- §33 left `cancelledBy` null on old rows because the information was genuinely
-- gone: several parties could have cancelled and nothing recorded which. Here
-- there is exactly one possible answer. One PaymentProvider implementation has
-- ever existed (MomoPaymentProvider, wired through PAYMENT_PROVIDER="momo"), so
-- every reference in this table was issued by MTN. Writing that down is
-- recording a fact, not inventing one.
--
-- Rows with no reference are left null: no payment was ever initiated, so there
-- is no operator to name.
UPDATE "appointments"
   SET "paymentProvider" = 'MTN_MOMO'
 WHERE "paymentProviderReferenceId" IS NOT NULL;
