-- Payouts settle in the settlement currency (§46).
--
-- A run sums settlementAmountMinor over entries that already carry it. It
-- performs no conversion and reads no exchange rate, so a rate change between
-- booking and payout cannot move a payout by a single minor unit.

-- Defaulted only so the columns can be added NOT NULL; every payout written
-- from now on supplies both explicitly. There are no existing rows to fill —
-- and if there were, a payout predating settlement amounts would have no honest
-- value to put here.
ALTER TABLE "payouts" ADD COLUMN "settlementCurrency"    TEXT    NOT NULL DEFAULT 'USD';
ALTER TABLE "payouts" ADD COLUMN "settlementAmountMinor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "payouts" ALTER COLUMN "settlementCurrency"    DROP DEFAULT;
ALTER TABLE "payouts" ALTER COLUMN "settlementAmountMinor" DROP DEFAULT;
