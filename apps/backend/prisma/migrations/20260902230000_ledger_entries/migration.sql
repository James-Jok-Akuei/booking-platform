-- The ledger (§34). One immutable row per money fact, from the business's
-- point of view. A business's balance is the SUM of these rows; there is no
-- balance column anywhere, and there must never be one.

CREATE TYPE "LedgerEntryType" AS ENUM (
  'DEPOSIT_RECEIVED',
  'PLATFORM_FEE',
  'DEPOSIT_REFUND',
  'PLATFORM_FEE_REVERSAL',
  'GATEWAY_FEE_DEBIT',
  'ADJUSTMENT'
);

CREATE TABLE "ledger_entries" (
  "id"                  TEXT NOT NULL,
  "businessId"          TEXT NOT NULL,
  "appointmentId"       TEXT,
  "type"                "LedgerEntryType" NOT NULL,
  -- SIGNED, from the business's perspective: positive is owed to them.
  "amountCents"         INTEGER NOT NULL,
  "currency"            TEXT NOT NULL DEFAULT 'USD',
  -- NULL = not yet payable. NULL payoutId = not yet settled, which is also the
  -- definition of money the platform is still holding.
  "availableAt"         TIMESTAMP(3),
  "payoutId"            TEXT,
  "billingAdjustmentId" TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- The payout run's query: one business's unsettled, now-payable entries.
CREATE INDEX "ledger_entries_businessId_payoutId_availableAt_idx"
  ON "ledger_entries"("businessId", "payoutId", "availableAt");
-- Everything that happened to one appointment.
CREATE INDEX "ledger_entries_appointmentId_idx" ON "ledger_entries"("appointmentId");

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not Cascade: deleting an appointment must not silently delete the
-- record of money that moved because of it.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_billingAdjustmentId_fkey"
  FOREIGN KEY ("billingAdjustmentId") REFERENCES "billing_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Immutability, enforced by the database rather than by convention.
--
-- What an entry SAYS is fixed at insert. What HAPPENED to it — when it became
-- payable, which payout settled it — is not part of the claim, so those two
-- columns stay writable. A correction is an opposing entry, never an edit:
-- otherwise the history that explains a balance can be rewritten to match
-- whatever the balance was supposed to be, and the ledger stops being evidence.
--
-- A trigger, not a CHECK, because a CHECK cannot see the previous row.
CREATE OR REPLACE FUNCTION "ledger_entries_reject_mutation"() RETURNS trigger AS $$
BEGIN
  IF NEW."type"                IS DISTINCT FROM OLD."type"
  OR NEW."amountCents"         IS DISTINCT FROM OLD."amountCents"
  OR NEW."currency"            IS DISTINCT FROM OLD."currency"
  OR NEW."businessId"          IS DISTINCT FROM OLD."businessId"
  OR NEW."appointmentId"       IS DISTINCT FROM OLD."appointmentId"
  OR NEW."billingAdjustmentId" IS DISTINCT FROM OLD."billingAdjustmentId"
  OR NEW."createdAt"           IS DISTINCT FROM OLD."createdAt"
  OR NEW."id"                  IS DISTINCT FROM OLD."id"
  THEN
    RAISE EXCEPTION
      'ledger_entries is append-only: type, amountCents, currency, businessId, appointmentId, billingAdjustmentId, createdAt and id cannot be changed after insert. Append an opposing entry instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_immutable"
  BEFORE UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_reject_mutation"();
