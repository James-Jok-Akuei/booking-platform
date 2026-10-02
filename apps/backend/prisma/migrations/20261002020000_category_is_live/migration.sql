-- §98. Categories a business may choose.
--
-- Defaults to true: every existing category keeps behaving exactly as it did,
-- and the admin turns off what should not be offered. The opposite default
-- would empty the picker on deploy.
ALTER TABLE "categories" ADD COLUMN "isLive" BOOLEAN NOT NULL DEFAULT true;
