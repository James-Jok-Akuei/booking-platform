-- A saved SERVICE, beside the saved places of §120 (§158).
--
-- Keyed on the service AT a branch, not the service: the same "Haircut" is
-- sold at two branches at two prices, and the one a customer saved is the one
-- they can walk to.
--
-- CASCADE from all three: a customer who closes their account takes their
-- list with them; a service or branch that is truly deleted (which the app
-- never does — both are soft) would take the saves with it.

CREATE TABLE "service_favourites" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_favourites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_favourites_customerId_serviceId_locationId_key"
    ON "service_favourites"("customerId", "serviceId", "locationId");
CREATE INDEX "service_favourites_customerId_createdAt_idx"
    ON "service_favourites"("customerId", "createdAt");

ALTER TABLE "service_favourites"
    ADD CONSTRAINT "service_favourites_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_favourites"
    ADD CONSTRAINT "service_favourites_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_favourites"
    ADD CONSTRAINT "service_favourites_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
