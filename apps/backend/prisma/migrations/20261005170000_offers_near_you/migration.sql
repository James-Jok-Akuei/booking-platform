-- Emails about services near a customer (§140).
--
-- Four columns on the user, and every one of them is empty until the customer
-- says yes:
--
--   offersOptInAt     WHEN they agreed. Null is "has not agreed", which is
--                     what everybody is until they turn it on. A timestamp
--                     rather than a boolean because "when did this person
--                     consent" is the question a regulator asks.
--   homeDistrictId    where "near" is measured from. A district the customer
--                     names — not a position taken from their phone.
--   offersToken       what an unsubscribe link carries, so one tap in an email
--                     works without signing in. Random, and replaced each time
--                     they opt in again.
--   offersLastSentAt  so nobody is sent two in a week, whatever the job does.

ALTER TABLE "users"
    ADD COLUMN "offersOptInAt" TIMESTAMP(3),
    ADD COLUMN "homeDistrictId" TEXT,
    ADD COLUMN "offersToken" TEXT,
    ADD COLUMN "offersLastSentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_offersToken_key" ON "users"("offersToken");

-- The weekly job reads "everyone opted in, by district".
CREATE INDEX "users_homeDistrictId_offersOptInAt_idx" ON "users"("homeDistrictId", "offersOptInAt");

-- SET NULL: a district is never deleted (§105.2), but if one ever were, the
-- customer keeps their account and simply has no home district.
ALTER TABLE "users"
    ADD CONSTRAINT "users_homeDistrictId_fkey"
    FOREIGN KEY ("homeDistrictId") REFERENCES "districts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
