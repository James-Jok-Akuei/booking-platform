-- Countries (§315): every shop and every place is in one country, and what
-- differs across a border — clock, money, phone numbers, networks, languages,
-- the platform's fee — is read from its row rather than written into code.
--
-- Rwanda is the one country today, so everything that exists is Rwanda's: the
-- rows below record that fact rather than invent one.

-- CreateTable
CREATE TABLE "countries" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "callingCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "locales" TEXT[],
    "networks" "MobileMoneyProvider"[],
    "phoneExample" TEXT NOT NULL,
    "platformFeePercentage" DECIMAL(5,2),
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "liveSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- Exactly one default country. Partial, because a plain unique on a boolean
-- would allow only one row to be false as well (the same reason as
-- "one_primary_admin").
CREATE UNIQUE INDEX "one_default_country" ON "countries" ((1)) WHERE "isDefault";

INSERT INTO "countries" ("code", "name", "callingCode", "currency", "timeZone", "locales", "networks", "phoneExample", "isLive", "isDefault", "liveSince", "updatedAt")
VALUES ('RW', 'Rwanda', '250', 'RWF', 'Africa/Kigali', ARRAY['en', 'rw', 'fr'], ARRAY['MTN_MOMO', 'AIRTEL_MONEY']::"MobileMoneyProvider"[], '+250 788 123 456', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Provinces belong to a country; their codes and names are unique within it.
ALTER TABLE "provinces" ADD COLUMN "countryCode" TEXT;
UPDATE "provinces" SET "countryCode" = 'RW';
ALTER TABLE "provinces" ALTER COLUMN "countryCode" SET NOT NULL;

DROP INDEX "provinces_code_key";
DROP INDEX "provinces_name_key";
CREATE INDEX "provinces_countryCode_idx" ON "provinces"("countryCode");
CREATE UNIQUE INDEX "provinces_countryCode_code_key" ON "provinces"("countryCode", "code");
CREATE UNIQUE INDEX "provinces_countryCode_name_key" ON "provinces"("countryCode", "name");
ALTER TABLE "provinces" ADD CONSTRAINT "provinces_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- District codes are unique within their province.
DROP INDEX "districts_code_key";
CREATE UNIQUE INDEX "districts_provinceId_code_key" ON "districts"("provinceId", "code");

-- Every shop is in a country. No column default: a new shop's country is
-- chosen by the code that makes it, never assumed by the database.
ALTER TABLE "business_profiles" ADD COLUMN "countryCode" TEXT;
UPDATE "business_profiles" SET "countryCode" = 'RW';
ALTER TABLE "business_profiles" ALTER COLUMN "countryCode" SET NOT NULL;
CREATE INDEX "business_profiles_countryCode_idx" ON "business_profiles"("countryCode");
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
