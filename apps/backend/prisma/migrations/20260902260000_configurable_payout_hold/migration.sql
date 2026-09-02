-- The payout hold becomes an admin setting (§38).
--
-- It was a 7-day constant in code. Default is now 2 days, which is a product
-- decision rather than a technical one and therefore belongs next to the
-- platform fee and the exchange rate, not in a deploy.
ALTER TABLE "platform_settings" ADD COLUMN "payoutHoldDays" INTEGER NOT NULL DEFAULT 2;

-- The hold that was actually applied when this appointment resolved.
--
-- Recorded because nothing stores the setting's history: without it, a business
-- asking "why is this payable on the 14th?" could only be answered with today's
-- setting, which may not be the one that produced the date. Null for
-- appointments resolved before this existed, and for those not yet resolved.
ALTER TABLE "appointments" ADD COLUMN "payoutHoldDaysApplied" INTEGER;
