-- Currency columns stop defaulting to USD (§66.3).
--
-- Four tables carried `DEFAULT 'USD'` on their currency column. That is correct
-- for a deployment denominated in dollars and silently wrong for any other: the
-- database stamps "USD" on a row holding Rwandan francs, and nothing downstream
-- can tell, because the number and the label are equally confident.
--
-- Caught by CurrencyGuard (§55.1) refusing to boot after the switch to RWF —
-- which is precisely the failure it was written to produce.
--
-- The column stays NOT NULL. Removing only the DEFAULT means every write must
-- state the unit, and the compiler lists any site that does not.
ALTER TABLE "services"       ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "appointments"   ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "ledger_entries" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "payouts"        ALTER COLUMN "currency" DROP DEFAULT;
