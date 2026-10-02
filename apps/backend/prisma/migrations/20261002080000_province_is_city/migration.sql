-- §106. A city is one place; a province is a region of separate towns.
ALTER TABLE "provinces" ADD COLUMN "isCity" BOOLEAN NOT NULL DEFAULT false;
UPDATE "provinces" SET "isCity" = true WHERE "code" = 'KIGALI';
