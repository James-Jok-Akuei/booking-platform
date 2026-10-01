-- §89. A branch is closed, never erased.
--
-- Two changes, and the second is the one that matters.

-- 1. The soft-delete flag, matching Service.isActive. Every existing location
--    is active: this is the behaviour they already had.
ALTER TABLE "locations" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- 2. appointments.locationId: Cascade -> Restrict.
--
--    Deleting a location used to delete every appointment ever made there.
--    From those appointments, reviews and chat threads cascaded away too,
--    while ledger entries survived with appointmentId set to null — money with
--    nothing left to explain it. The code comment on the delete said "a
--    location has no historical appointment references to preserve yet",
--    which stopped being true when Appointment gained a locationId.
--
--    Restrict makes that path impossible rather than merely unused.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_locationId_fkey";
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Branch lists and discovery filter on this constantly.
CREATE INDEX "locations_businessId_isActive_idx" ON "locations"("businessId", "isActive");
