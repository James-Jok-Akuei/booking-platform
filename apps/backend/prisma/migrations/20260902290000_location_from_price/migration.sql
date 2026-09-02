-- Denormalised cheapest active price per location (§44).
--
-- The same pattern as ratingAvg/ratingCount: an aggregate maintained on write.
-- §43.6 shipped sort=price falling back to name ordering because the price
-- lived on the business's services and SQL could not order a page by it. This
-- column is what fixes that — and it lets the filter and the sort read the same
-- number instead of two independently-derived ones.
ALTER TABLE "locations" ADD COLUMN "fromPriceCents" INTEGER;

-- Backfilled, unlike the appointment pricing snapshot (§30). This is a DERIVED
-- value with exactly one correct answer available right now, so computing it is
-- recovering a fact rather than inventing one.
UPDATE "locations" l
   SET "fromPriceCents" = (
     SELECT MIN(s."priceCents")
       FROM "services" s
      WHERE s."businessId" = l."businessId"
        AND s."isActive" = true
   );

-- Serves ORDER BY "fromPriceCents" and the maxPriceCents filter.
CREATE INDEX "locations_fromPriceCents_idx" ON "locations"("fromPriceCents");
