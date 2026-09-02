-- Settlement amounts on the ledger (§45).
--
-- The business's payable is fixed at the BOOKING-DATE rate. A payout therefore
-- performs no conversion and reads no exchange rate — every entry already
-- carries the amount it will be paid in.

ALTER TABLE "ledger_entries" ADD COLUMN "settlementCurrency"    TEXT;
ALTER TABLE "ledger_entries" ADD COLUMN "settlementAmountMinor" INTEGER;
ALTER TABLE "ledger_entries" ADD COLUMN "bookingExchangeRate"   DECIMAL(18,8);

-- ---------------------------------------------------------------------------
-- Backfill, BEFORE the immutability trigger is extended to cover these columns.
-- Ordering matters: once the trigger names them, this UPDATE would be rejected
-- by the very rule it is populating the data for.
--
-- Only entries whose appointment actually recorded a charged amount can be
-- filled. The deposit takes the charged figure; the fee takes its proportion of
-- it, rounded ONCE, exactly as the application does — so a backfilled pair and a
-- freshly written pair are indistinguishable.
UPDATE "ledger_entries" le
   SET "settlementCurrency"    = a."providerCurrency",
       "bookingExchangeRate"   = a."exchangeRateUsed",
       "settlementAmountMinor" = CASE le."type"
         WHEN 'DEPOSIT_RECEIVED' THEN  a."providerCurrencyAmountCents"
         WHEN 'PLATFORM_FEE'     THEN -ROUND(
                a."providerCurrencyAmountCents"::numeric
              * a."platformFeeAmountCents"::numeric
              / NULLIF(a."depositAmountCents", 0)::numeric)
         WHEN 'DEPOSIT_REFUND'   THEN -a."providerCurrencyAmountCents"
         WHEN 'PLATFORM_FEE_REVERSAL' THEN ROUND(
                a."providerCurrencyAmountCents"::numeric
              * a."platformFeeAmountCents"::numeric
              / NULLIF(a."depositAmountCents", 0)::numeric)
         ELSE NULL
       END
  FROM "appointments" a
 WHERE le."appointmentId" = a."id"
   AND a."providerCurrency" IS NOT NULL
   AND a."providerCurrencyAmountCents" IS NOT NULL;

-- Anything left NULL is not guessed at. GATEWAY_FEE_DEBIT and ADJUSTMENT rows
-- predating §45 have no recorded settlement figure, and an entry with no
-- appointment has nothing to derive one from. Payouts exclude and report them.

-- ---------------------------------------------------------------------------
-- Extend immutability to the settlement columns. A payout amount that could be
-- edited after the fact is not a ledger.
CREATE OR REPLACE FUNCTION "ledger_entries_reject_mutation"() RETURNS trigger AS $$
BEGIN
  IF NEW."type"                  IS DISTINCT FROM OLD."type"
  OR NEW."amountCents"           IS DISTINCT FROM OLD."amountCents"
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
      'ledger_entries is append-only: type, amountCents, currency, settlementCurrency, settlementAmountMinor, bookingExchangeRate, businessId, appointmentId, billingAdjustmentId, createdAt and id cannot be changed after insert. Append an opposing entry instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The payout run groups by (businessId, settlementCurrency).
CREATE INDEX "ledger_entries_businessId_settlementCurrency_payoutId_idx"
  ON "ledger_entries"("businessId", "settlementCurrency", "payoutId");
