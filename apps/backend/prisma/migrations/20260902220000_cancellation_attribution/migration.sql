-- Record who cancelled an appointment, and whether its deposit was ever paid (§33).
--
-- §25's refund policy turns on WHICH party called an appointment off. Nothing
-- recorded it: cancel() derived the actor to build a notification sentence and
-- then discarded it, and the expiry sweep was indistinguishable from a real
-- cancellation. This commit records the state. It moves no money.

CREATE TYPE "CancelledBy" AS ENUM ('CUSTOMER', 'BUSINESS', 'SYSTEM_EXPIRY');

-- Two columns, not one. cancelledBy is the party who bears responsibility,
-- which is what decides the money outcome; cancelledByUserId is who physically
-- performed the action. They diverge when an admin resolves a dispute by
-- reclassifying an appointment as business-cancelled: BUSINESS bears it, the
-- admin performed it, and cancellationTicketId says why. Collapsing them would
-- force a second refund path for admin-resolved cancellations.
ALTER TABLE "appointments" ADD COLUMN "cancelledBy" "CancelledBy";
ALTER TABLE "appointments" ADD COLUMN "cancelledByUserId" TEXT;
ALTER TABLE "appointments" ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "appointments" ADD COLUMN "cancellationTicketId" TEXT;

-- Set once when the provider confirms the deposit, and never cleared. Status
-- cannot answer "was this ever paid?" because later transitions destroy the
-- evidence: a CANCELLED row looks the same whether it was an expired unpaid
-- hold or a deposit that was taken and then called off. That is exactly why the
-- collected-deposits figure could only be reported as a floor (§29.1).
ALTER TABLE "appointments" ADD COLUMN "depositPaidAt" TIMESTAMP(3);

-- SetNull on both: an audit trail that deletes the appointment along with the
-- admin who acted, or the ticket that explained it, is not an audit trail.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_cancellationTicketId_fkey"
  FOREIGN KEY ("cancellationTicketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No backfill. Existing CANCELLED rows keep cancelledBy NULL, meaning "not
-- recorded" — and analytics reads it exactly that way, as the marker for a row
-- that predates this migration. Inferring the party from timestamps or status
-- would manufacture the answer to the one question the data never held, and
-- that answer would go on to decide who gets refunded.
