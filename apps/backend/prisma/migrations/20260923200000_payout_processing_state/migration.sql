-- Automated disbursement needs a state between "not sent" and "paid" (§64.3).
--
-- Without it, PENDING would mean both "nobody has sent this" and "it is with
-- the operator and we do not yet know" — and the difference between those is
-- whether pressing send again pays the business twice. §33.3's rule: a status
-- that cannot tell two situations apart is a status that forgets.
--
-- WRITTEN BY HAND: Prisma emits an unpositioned ADD VALUE, and the reading
-- order of a status enum is worth keeping sensible.
ALTER TYPE "PayoutStatus" ADD VALUE 'PROCESSING' AFTER 'PENDING';

-- Our own reference for the transfer, written BEFORE the operator is called.
ALTER TABLE "payouts" ADD COLUMN "providerReferenceId" TEXT;
ALTER TABLE "payouts" ADD COLUMN "sentAt" TIMESTAMP(3);

-- No backfill. Every existing payout was sent by hand or not at all, so there
-- is no provider reference to record and nothing was ever "handed over".
