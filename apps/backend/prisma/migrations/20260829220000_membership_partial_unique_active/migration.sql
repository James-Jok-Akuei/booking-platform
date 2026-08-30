-- One business per person, but only while ACTIVE.
--
-- The blanket unique index on business_memberships."userId" applied to every
-- row, REMOVED ones included. Because removal is a soft delete, a departed
-- member's row kept occupying their one slot forever, so they could never join
-- a different business again. Rejoining the SAME business still worked, since
-- that path reactivates the existing row rather than inserting another.
--
-- Postgres partial indexes express the intended rule exactly: unique across
-- ACTIVE rows, unconstrained across the historical REMOVED ones. Prisma's
-- schema DSL has no syntax for a WHERE clause on an index, which is why this
-- migration is written by hand.

-- Safety check. The old blanket unique guarantees at most one row per user, so
-- this cannot fire on existing data — but if this migration is ever replayed
-- against a database that reached this point another way, failing loudly beats
-- silently skipping the constraint. CREATE UNIQUE INDEX would error anyway;
-- this makes the reason legible.
DO $$
DECLARE
  offending INT;
BEGIN
  SELECT COUNT(*) INTO offending FROM (
    SELECT "userId" FROM "business_memberships"
    WHERE "status" = 'ACTIVE'
    GROUP BY "userId" HAVING COUNT(*) > 1
  ) dupes;

  IF offending > 0 THEN
    RAISE EXCEPTION
      'Cannot apply partial unique index: % user(s) already hold more than one ACTIVE membership. Resolve these before migrating.', offending;
  END IF;
END $$;

-- DropIndex: the blanket unique that covered REMOVED rows too.
DROP INDEX "business_memberships_userId_key";

-- CreateIndex: one ACTIVE membership per person. REMOVED rows are exempt, so a
-- departed member is free to join somewhere else while their history survives.
CREATE UNIQUE INDEX "business_memberships_active_userId_key"
  ON "business_memberships" ("userId")
  WHERE "status" = 'ACTIVE';

-- CreateIndex: at most one row per person per business, whatever its status.
-- Keeps a person's history with one business as a single row that flips
-- between ACTIVE and REMOVED, which is what lets the re-hire path reactivate
-- unambiguously instead of choosing between duplicates.
CREATE UNIQUE INDEX "business_memberships_userId_businessProfileId_key"
  ON "business_memberships" ("userId", "businessProfileId");

-- CreateIndex: supports the ACTIVE-membership lookup every guarded request makes.
CREATE INDEX "business_memberships_userId_status_idx"
  ON "business_memberships" ("userId", "status");
