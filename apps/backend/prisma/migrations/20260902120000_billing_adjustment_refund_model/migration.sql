-- Correct BillingAdjustment to the fee model this platform actually uses.
--
-- The table was specced against monthly invoicing, which this platform does not
-- do: the platform fee is a percentage taken out of the customer's deposit at
-- booking time (DECISIONS.md §2, §16.3). There is no invoice to credit, only a
-- fee already collected that may need refunding.
--
-- Safe to rewrite in place rather than migrate data: the table is empty. It has
-- never had a write path — rows are only created by an admin resolving a
-- ticket, and the feature shipped in the previous commit.

-- The enum is replaced rather than renamed value-by-value. Postgres can rename
-- an enum value in place, but the type also changes meaning here, and a clean
-- replacement keeps the migration readable. Guarded by the emptiness check
-- below so this cannot silently discard rows.
DO $$
DECLARE
  existing INT;
BEGIN
  SELECT COUNT(*) INTO existing FROM "billing_adjustments";
  IF existing > 0 THEN
    RAISE EXCEPTION
      'billing_adjustments holds % row(s). This migration assumes the table is empty; map the old FEE_CREDIT/FEE_CHARGE values before applying.', existing;
  END IF;
END $$;

-- DropIndex
DROP INDEX "billing_adjustments_businessId_appliedInvoiceId_idx";

-- AlterTable: invoicing never existed, so the column that pointed at one goes.
ALTER TABLE "billing_adjustments" DROP COLUMN "appliedInvoiceId";
ALTER TABLE "billing_adjustments"
    ADD COLUMN "settledAt" TIMESTAMP(3),
    ADD COLUMN "settlementRef" TEXT;

-- AlterEnum: FEE_CREDIT -> FEE_REFUND, FEE_CHARGE -> GATEWAY_FEE_DEBIT.
ALTER TABLE "billing_adjustments" ALTER COLUMN "type" TYPE TEXT;
DROP TYPE "BillingAdjustmentType";
CREATE TYPE "BillingAdjustmentType" AS ENUM ('FEE_REFUND', 'GATEWAY_FEE_DEBIT');
ALTER TABLE "billing_adjustments"
    ALTER COLUMN "type" TYPE "BillingAdjustmentType" USING "type"::"BillingAdjustmentType";

-- CreateIndex: the query a future settlement run makes.
CREATE INDEX "billing_adjustments_businessId_settledAt_idx" ON "billing_adjustments"("businessId", "settledAt");
