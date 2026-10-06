-- An exact spot for "Offers near me" (§169), beside the district of §140.
--
-- Optional, and set only by the customer pressing "Use my exact location":
-- a district can be ten kilometres across, and "near you" measured from a
-- district is a guess. The label is what the phone called the place (a street,
-- an area) so the customer can see what was saved; the coordinates are what
-- distances are measured from. All three are cleared together.
ALTER TABLE "users"
    ADD COLUMN "homeLatitude" DOUBLE PRECISION,
    ADD COLUMN "homeLongitude" DOUBLE PRECISION,
    ADD COLUMN "homeLabel" TEXT;

ALTER TABLE "users"
    ADD CONSTRAINT "users_home_spot_check" CHECK (
        ("homeLatitude" IS NULL) = ("homeLongitude" IS NULL)
    );
