-- Booking more than one (§136).
--
-- "Three" means different things for different services, so the SERVICE says
-- which: three people (a haircut for a mother and two children) or three of
-- the thing for one customer (three passport photos). SINGLE is every service
-- that exists today, which is why it is the default and nothing is backfilled.

CREATE TYPE "QuantityMode" AS ENUM ('SINGLE', 'PEOPLE', 'UNITS');

ALTER TABLE "services"
    ADD COLUMN "quantityMode" "QuantityMode" NOT NULL DEFAULT 'SINGLE',
    ADD COLUMN "maxQuantity" INTEGER NOT NULL DEFAULT 1;

-- The two columns cannot disagree: a one-per-booking service has a maximum of
-- one, and a service that allows several allows at least two.
ALTER TABLE "services"
    ADD CONSTRAINT "services_quantity_check" CHECK (
        ("quantityMode" = 'SINGLE' AND "maxQuantity" = 1)
        OR ("quantityMode" <> 'SINGLE' AND "maxQuantity" BETWEEN 2 AND 20)
    );

-- What was booked, snapshotted like the money beside it: a business may change
-- a service's rule later, and that must not rewrite a booking already made.
--
--   quantity       how many the customer asked for
--   capacityUnits  how many of the branch's places it occupies at once
--   unitPriceMinor the price of ONE; servicePriceMinor stays the price of the
--                  whole booking, so everything that already reads it (the
--                  balance due at the shop, the analytics sums) stays right.
ALTER TABLE "appointments"
    ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "capacityUnits" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "unitPriceMinor" INTEGER;

UPDATE "appointments" SET "unitPriceMinor" = "servicePriceMinor";

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_quantity_check" CHECK ("quantity" >= 1 AND "capacityUnits" >= 1);
