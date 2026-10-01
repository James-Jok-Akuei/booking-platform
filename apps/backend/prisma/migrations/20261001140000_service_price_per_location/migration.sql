-- A service is offered at chosen branches, at each branch's own price (§72).
--
-- Reverses §10.2. Services belonged to the business and were shared by every
-- location at one price, so a chain whose city-centre shop charges more than
-- its suburban one had to invent two services with the same name — and every
-- branch offered everything whether it did that work or not.
--
-- WRITTEN BY HAND because of the backfill order: the price has to be copied out
-- of `services` before the column is dropped, and Prisma would do neither.

-- ---------------------------------------------------------------------------
CREATE TABLE "service_locations" (
  "id"         TEXT NOT NULL,
  "serviceId"  TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_locations_pkey" PRIMARY KEY ("id")
);

-- One offer per service per branch: two rows would be two prices with no rule
-- for which wins.
CREATE UNIQUE INDEX "service_locations_serviceId_locationId_key"
  ON "service_locations"("serviceId", "locationId");

-- "What does this branch offer" is the discovery read.
CREATE INDEX "service_locations_locationId_idx" ON "service_locations"("locationId");

ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill BEFORE dropping the column.
--
-- Every existing service is linked to every location of its business, at the
-- price it already had. That is exactly today's behaviour expressed in the new
-- shape, so nothing in flight changes: the same services are bookable at the
-- same branches for the same money, and a business narrows the list when it
-- chooses to rather than being forced to re-enter its catalogue.
INSERT INTO "service_locations" ("id", "serviceId", "locationId", "priceMinor", "updatedAt")
SELECT gen_random_uuid(), s."id", l."id", s."priceMinor", CURRENT_TIMESTAMP
  FROM "services" s
  JOIN "locations" l ON l."businessId" = s."businessId";

-- ---------------------------------------------------------------------------
-- Only now is the old column redundant.
--
-- Past appointments are unaffected: each one snapshots `servicePriceMinor` at
-- booking (§30), so what a customer agreed to is recorded on the appointment
-- and never read back off the service.
ALTER TABLE "services" DROP COLUMN "priceMinor";
