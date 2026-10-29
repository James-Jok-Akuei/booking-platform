-- Money access (§317): only the primary administrator, and those they choose,
-- see and move the platform's money. Nobody else starts with it.
ALTER TABLE "users"
  ADD COLUMN "moneyAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "moneyAccessAt" TIMESTAMP(3),
  ADD COLUMN "moneyAccessBy" TEXT;

-- Except where there is no primary administrator (a copy seeded for
-- development): nobody there could ever turn it on, so the administrators
-- already there keep the money pages they had.
UPDATE "users"
SET "moneyAccess" = true, "moneyAccessAt" = now(), "moneyAccessBy" = 'automatic'
WHERE "role" = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM "users" p WHERE p."isPrimaryAdmin");
