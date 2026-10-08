-- One rule for "how many" (§189): the branch's places, nothing on the service.
--
-- A service no longer says whether it can be booked for several, what
-- "several" means, or how many at most. A booking for three people takes three
-- of the branch's places at the same time; the most anyone can book is the
-- places the branch has. Bookings already made keep their quantity and the
-- places they took (appointments.capacityUnits), so nothing booked changes.

ALTER TABLE "services" DROP CONSTRAINT "services_quantity_check";

ALTER TABLE "services"
    DROP COLUMN "quantityMode",
    DROP COLUMN "maxQuantity";

DROP TYPE "QuantityMode";
