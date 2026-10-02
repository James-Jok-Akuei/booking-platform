-- §100. Subcategories can be opened and closed like categories.
--
-- Defaults to true, same reasoning as the parent: every seeded row keeps
-- behaving exactly as it did, and the admin closes what should not be offered.
ALTER TABLE "subcategories" ADD COLUMN "isLive" BOOLEAN NOT NULL DEFAULT true;
