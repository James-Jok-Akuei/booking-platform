-- Payout runs (§35).
--
-- A payout is a claim that money was sent to a business. It carries no
-- arithmetic of its own: amountCents is the sum of the ledger entries stamped
-- with its id, and those entries stay the authority.

CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

CREATE TABLE "payouts" (
  "id"            TEXT NOT NULL,
  "businessId"    TEXT NOT NULL,
  "amountCents"   INTEGER NOT NULL,
  "currency"      TEXT NOT NULL DEFAULT 'USD',
  "status"        "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  -- Required before a payout may be marked PAID: without a provider reference
  -- nothing can be reconciled against a statement, and a statement is the only
  -- thing that proves the money actually left.
  "reference"     TEXT,
  -- Required before a payout may be marked FAILED. Marking it failed returns
  -- money to the pool, and someone will ask later why it did not go out.
  "failureReason" TEXT,
  "runAt"         TIMESTAMP(3) NOT NULL,
  "paidAt"        TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payouts_businessId_status_idx" ON "payouts"("businessId", "status");
CREATE INDEX "payouts_status_runAt_idx" ON "payouts"("status", "runAt");

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, deliberately: marking a payout FAILED unstamps its entries so they
-- return to the pool and go out on the next run.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
