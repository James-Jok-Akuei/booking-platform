-- Customer display names for reviews (§31).
--
-- Held on the user, not on each review, so a customer who changes their name
-- changes it everywhere at once rather than accumulating one name per review.
--
-- Nullable with no backfill, and deliberately NOT defaulted to 'Anonymous':
-- null means "never supplied", which readers render as "Anonymous". Writing
-- the literal string would erase the difference between a customer who chose
-- that word and one who skipped the field, and admin moderation clears a name
-- back to null — so null has to keep meaning exactly one thing.
ALTER TABLE "users" ADD COLUMN "displayName" TEXT;

-- Sent to the customer when an admin clears their display name, mirroring the
-- notification review hiding already sends: moderation that nobody is told
-- about looks like a bug to the person it happened to.
ALTER TYPE "NotificationType" ADD VALUE 'DISPLAY_NAME_CLEARED';
