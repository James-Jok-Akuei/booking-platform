-- Currency tracking.
--
-- The platform's internal unit of account is USD. Every price, deposit and fee
-- is computed and stored in USD cents; conversion to whatever the payment
-- provider charges in happens only at the moment of charging.
--
-- Existing rows are backfilled to 'USD' explicitly rather than relying on the
-- column default. The default covers future inserts; the UPDATE covers rows
-- written before the column existed. Both are needed, and the point of the
-- column is precisely that these amounts should never have to be guessed at.

-- AlterTable: services
ALTER TABLE "services" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
UPDATE "services" SET "currency" = 'USD' WHERE "currency" IS DISTINCT FROM 'USD';

-- AlterTable: appointments — the currency of the three stored amounts, plus
-- what was actually charged at the provider.
ALTER TABLE "appointments"
    ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
    ADD COLUMN "providerCurrency" TEXT,
    ADD COLUMN "providerCurrencyAmountCents" INTEGER,
    ADD COLUMN "exchangeRateUsed" DECIMAL(18,8);
UPDATE "appointments" SET "currency" = 'USD' WHERE "currency" IS DISTINCT FROM 'USD';

-- AlterTable: platform settings gain the provider currency and the manual rate.
-- The rate is deliberately left NULL: there is no honest default for an
-- exchange rate, and payment initiation fails loudly rather than guessing.
ALTER TABLE "platform_settings"
    ADD COLUMN "providerCurrency" TEXT NOT NULL DEFAULT 'EUR',
    ADD COLUMN "exchangeRateUsdToProviderCurrency" DECIMAL(18,8),
    ADD COLUMN "exchangeRateUpdatedAt" TIMESTAMP(3);
