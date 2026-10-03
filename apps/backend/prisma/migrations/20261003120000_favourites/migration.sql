-- Places a customer saved to come back to (§120).
--
-- Cascade on both sides, which is right here and would not be anywhere near the
-- ledger: a favourite records an intention, not a transaction. Nothing is owed
-- because of one, so losing it with the customer or the branch costs nothing.

CREATE TABLE "favourites" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favourites_pkey" PRIMARY KEY ("id")
);

-- Saving twice is saving once. Enforced here rather than by a read-then-write,
-- which two taps both pass.
CREATE UNIQUE INDEX "favourites_customerId_locationId_key"
    ON "favourites"("customerId", "locationId");

-- The only query there is.
CREATE INDEX "favourites_customerId_createdAt_idx"
    ON "favourites"("customerId", "createdAt");

ALTER TABLE "favourites" ADD CONSTRAINT "favourites_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
