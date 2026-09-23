-- Money columns stop claiming to hold cents (§56).
--
-- Every column below holds the MINOR UNITS of some currency, which is only
-- "cents" when that currency happens to have two decimal places. Since §55 the
-- internal unit of account is configurable, so in a deployment priced in a
-- zero-decimal currency every one of these names is a lie that reads as a
-- factor of 100.
--
-- WRITTEN BY HAND. `prisma migrate dev` cannot see a rename: it generates
-- DROP COLUMN + ADD COLUMN, which would silently delete every amount in the
-- database. RENAME COLUMN preserves the data, the type and the constraints.

-- ---------------------------------------------------------------------------
-- Internal-currency amounts
-- ---------------------------------------------------------------------------
ALTER TABLE "appointments" RENAME COLUMN "depositAmountCents"     TO "depositAmountMinor";
ALTER TABLE "appointments" RENAME COLUMN "platformFeeAmountCents" TO "platformFeeAmountMinor";
ALTER TABLE "appointments" RENAME COLUMN "businessAmountCents"    TO "businessAmountMinor";
ALTER TABLE "appointments" RENAME COLUMN "servicePriceCents"      TO "servicePriceMinor";

ALTER TABLE "services"  RENAME COLUMN "priceCents"     TO "priceMinor";
ALTER TABLE "locations" RENAME COLUMN "fromPriceCents" TO "fromPriceMinor";

ALTER TABLE "ledger_entries" RENAME COLUMN "amountCents" TO "amountMinor";
ALTER TABLE "payouts"        RENAME COLUMN "amountCents" TO "amountMinor";

-- ---------------------------------------------------------------------------
-- Provider-currency amounts (§51.5)
-- ---------------------------------------------------------------------------
-- Never cents in the first place: this is what the payment provider was asked
-- for, in ITS currency's minor units, which is why it sits beside
-- "providerCurrency".
ALTER TABLE "appointments"
  RENAME COLUMN "providerCurrencyAmountCents" TO "providerAmountMinor";

-- ---------------------------------------------------------------------------
-- Index names follow their column
-- ---------------------------------------------------------------------------
ALTER INDEX "locations_fromPriceCents_idx" RENAME TO "locations_fromPriceMinor_idx";

-- ---------------------------------------------------------------------------
-- The immutability trigger names its columns, so it has to be rebuilt
-- ---------------------------------------------------------------------------
-- Not optional housekeeping: the function body references OLD."amountCents",
-- which no longer exists. Left alone, every INSERT into ledger_entries would
-- fail at runtime — the append-only guarantee would take the ledger down with
-- it. Recreated with the new name and the same set of protected columns.
CREATE OR REPLACE FUNCTION "ledger_entries_reject_mutation"() RETURNS trigger AS $$
BEGIN
  IF NEW."type"                  IS DISTINCT FROM OLD."type"
  OR NEW."amountMinor"           IS DISTINCT FROM OLD."amountMinor"
  OR NEW."currency"              IS DISTINCT FROM OLD."currency"
  OR NEW."settlementCurrency"    IS DISTINCT FROM OLD."settlementCurrency"
  OR NEW."settlementAmountMinor" IS DISTINCT FROM OLD."settlementAmountMinor"
  OR NEW."bookingExchangeRate"   IS DISTINCT FROM OLD."bookingExchangeRate"
  OR NEW."businessId"            IS DISTINCT FROM OLD."businessId"
  OR NEW."appointmentId"         IS DISTINCT FROM OLD."appointmentId"
  OR NEW."billingAdjustmentId"   IS DISTINCT FROM OLD."billingAdjustmentId"
  OR NEW."createdAt"             IS DISTINCT FROM OLD."createdAt"
  OR NEW."id"                    IS DISTINCT FROM OLD."id"
  THEN
    RAISE EXCEPTION
      'ledger_entries is append-only: type, amountMinor, currency, settlementCurrency, settlementAmountMinor, bookingExchangeRate, businessId, appointmentId, billingAdjustmentId, createdAt and id cannot be changed after insert. Append an opposing entry instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
