-- Exchange-rate staleness (§37).
--
-- The rate is set by hand and has no live feed behind it. It was already
-- timestamped, but nothing said WHO set it, nothing defined how old is too old,
-- and nothing told anybody when it drifted past that.

-- "When" alone does not say who to ask about a rate that looks wrong.
ALTER TABLE "platform_settings" ADD COLUMN "exchangeRateUpdatedById" TEXT;

-- Configurable, because the right threshold depends on how fast the currency is
-- actually moving. 24 hours suits a stable pair and is far too slow for a
-- collapsing one.
ALTER TABLE "platform_settings" ADD COLUMN "exchangeRateStalenessHours" INTEGER NOT NULL DEFAULT 24;

-- Debounces the reminder to once a day. A stale rate that mails admins every
-- fifteen minutes trains them to ignore the mail.
ALTER TABLE "platform_settings" ADD COLUMN "exchangeRateStaleNotifiedAt" TIMESTAMP(3);

-- SetNull: losing the admin account must not lose the rate.
ALTER TABLE "platform_settings"
  ADD CONSTRAINT "platform_settings_exchangeRateUpdatedById_fkey"
  FOREIGN KEY ("exchangeRateUpdatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "NotificationType" ADD VALUE 'EXCHANGE_RATE_STALE';
