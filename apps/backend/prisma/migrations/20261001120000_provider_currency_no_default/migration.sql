-- platform_settings.providerCurrency stops defaulting to EUR (§67.5 follow-up).
--
-- The default was a sandbox leftover: MTN's sandbox accepts only EUR, so the
-- column was given EUR and nobody looked again. The effect in any other
-- deployment is that a settings row created by an unrelated write — setting the
-- payout hold, say — silently declares that the platform collects in euros.
--
-- That is how §67.5 surfaced: the platform "collected in EUR" with no rate to
-- reach EUR, so no ledger entry could state a settlement amount.
--
-- Same reasoning as §66.3 removing the USD defaults: a currency default cannot
-- be right for every deployment, and one the database applies silently is worse
-- than none. The service now states the unit of account on every create.
ALTER TABLE "platform_settings" ALTER COLUMN "providerCurrency" DROP DEFAULT;

-- Existing rows keep whatever they hold. A deployment genuinely collecting in a
-- foreign currency is a real configuration, not something to rewrite here.
