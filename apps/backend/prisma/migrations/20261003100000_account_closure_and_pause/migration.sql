-- Closing an account, and pausing a shop (§119).
--
-- Both are soft, for the reason §89 established: the foreign keys out of `users`
-- are mostly CASCADE, so deleting one person removes every appointment they ever
-- made, every review they left, and leaves `ledger_entries.appointmentId` NULL —
-- money owed to a business with no record of what it was for.

ALTER TABLE "users" ADD COLUMN "closedAt" TIMESTAMP(3);

-- Partial: the only rows ever looked up by this are the closed ones, and on a
-- platform where almost nobody closes their account an index over all of them
-- would be mostly NULLs.
CREATE INDEX "users_closedAt_idx" ON "users" ("closedAt") WHERE "closedAt" IS NOT NULL;

ALTER TABLE "business_profiles" ADD COLUMN "pausedAt" TIMESTAMP(3);
