-- Withdrawing a service from a branch becomes a toggle (§74).
--
-- §73 deleted the offer row. That lost the price: a branch pausing a service for
-- a month had to retype what it cost to resume, and the model called that
-- clean. It was data loss.
--
-- "Paused at this branch" and "retired everywhere" are also not the same state,
-- so keeping both is not two ways of saying one thing — which was the reasoning
-- §73.1 used to argue against exactly this column.
ALTER TABLE "service_locations"
  ADD COLUMN "isOffered" BOOLEAN NOT NULL DEFAULT true;

-- Every existing row is an active offer: §73 deleted rather than disabled, so
-- anything still present was being sold.

-- The discovery read is "what is this branch selling right now".
DROP INDEX IF EXISTS "service_locations_locationId_idx";
CREATE INDEX "service_locations_locationId_isOffered_idx"
  ON "service_locations"("locationId", "isOffered");
