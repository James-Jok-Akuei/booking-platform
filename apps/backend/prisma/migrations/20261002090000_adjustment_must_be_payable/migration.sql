-- A billing ADJUSTMENT that cannot be paid out is refused by the database (§115).
--
-- §67.5 found adjustments written with both settlement columns null. A payout
-- run excludes entries with no settlement figure — there is no amount to send —
-- so each one was money sitting in a balance, counted in a total, and unpayable
-- forever. §68 fixed the code. This stops the database accepting another,
-- whatever writes it: a seed script, a psql session, or the next service.
--
-- ONLY adjustments, and that narrowing is the whole point.
--
-- §67's recommendation was the broad version: settlement required on EVERY
-- entry. Written that way it failed five existing tests, and the failures were
-- right. A DEPOSIT_RECEIVED entry legitimately has no settlement figure when the
-- appointment never went through the payment initiation that records the charged
-- amount (ledger.service.ts) — the pre-§45 shape — and payouts already exclude
-- those rather than convert at a guessed rate.
--
-- Forbidding them outright would put the constraint INSIDE the transaction that
-- confirms a deposit. It would roll back, the appointment would stay
-- PENDING_PAYMENT, and the operator would have taken the customer's money with
-- nothing recorded. That is far worse than an entry nobody can be paid, and it
-- is exactly what §34's "a confirmed deposit that failed to reach the ledger is
-- money the platform holds and cannot account for" is about.
--
-- An adjustment has no such risk. Nothing has moved when it is written, so a
-- refusal just means the adjustment is not applied — which is already what §68.2
-- made the service do. This is the same rule, one layer down, where no bug in
-- the layer above can get past it.
--
-- NOT VALID so rows already written are left alone. The pre-§45 entries are real
-- history on an append-only table: satisfying NOT VALID's alternative would mean
-- disabling `ledger_entries_immutable`, the trigger that names these very
-- columns, to rewrite figures nobody ever recorded. To enforce it over history
-- as well, once somebody has decided what those rows mean:
--
--   ALTER TABLE "ledger_entries" VALIDATE CONSTRAINT "ledger_entries_adjustment_payable";
--
-- `bookingExchangeRate` is not included: a payout run reads only the two below,
-- and the rate is context for a reader rather than something money depends on.

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_adjustment_payable"
  CHECK (
    "type" <> 'ADJUSTMENT'
    OR ("settlementCurrency" IS NOT NULL AND "settlementAmountMinor" IS NOT NULL)
  )
  NOT VALID;
