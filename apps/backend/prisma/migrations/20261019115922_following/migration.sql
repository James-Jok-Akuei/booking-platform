-- §288: following a shop is its own thing; its offers as notifications are a
-- separate yes. Saved places become follows.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SHOP_DISCOUNT';

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "discountToldEndsOn" DATE,
ADD COLUMN     "discountToldPercent" INTEGER;

-- AlterTable
ALTER TABLE "shop_follows" ADD COLUMN     "offersAt" TIMESTAMP(3);

-- Every follow so far was made with the offers question answered yes (§287).
UPDATE "shop_follows" SET "offersAt" = "createdAt";

-- A saved place becomes a follow of its shop — without offers: nobody who
-- saved a place was asked about offers, so none are sent until they say yes.
INSERT INTO "shop_follows" ("userId", "businessId", "createdAt")
SELECT DISTINCT ON (f."customerId", l."businessId") f."customerId", l."businessId", f."createdAt"
FROM "favourites" f
JOIN "locations" l ON l."id" = f."locationId"
ORDER BY f."customerId", l."businessId", f."createdAt" ASC
ON CONFLICT ("userId", "businessId") DO NOTHING;

-- Discounts already running are not news: followers hear only of new ones.
UPDATE "services" SET "discountToldPercent" = "discountPercent", "discountToldEndsOn" = "discountEndsOn"
WHERE "discountPercent" IS NOT NULL;
