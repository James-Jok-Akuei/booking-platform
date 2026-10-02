-- §105. Which districts the platform is open in.
--
-- Defaults to true so nothing changes on deploy and the backfilled branches
-- stay findable. The admin retires what is not wanted — the same default and
-- the same reasoning as Category.isLive (§98).
ALTER TABLE "districts" ADD COLUMN "isLive" BOOLEAN NOT NULL DEFAULT true;
