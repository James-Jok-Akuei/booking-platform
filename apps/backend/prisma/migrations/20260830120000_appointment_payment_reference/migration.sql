-- Deposit payment tracking on Appointment.
--
-- Both columns are nullable with no backfill: an appointment that predates this
-- migration simply never had a payment initiated through a provider, which is
-- exactly what NULL means here.

-- AlterTable
ALTER TABLE "appointments"
    ADD COLUMN "paymentProviderReferenceId" TEXT,
    ADD COLUMN "paymentInitiatedAt" TIMESTAMP(3);

-- CreateIndex: serves both the payment-confirmation poll and the
-- PENDING_PAYMENT expiry sweep, which scan by status and creation time.
CREATE INDEX "appointments_status_createdAt_idx" ON "appointments"("status", "createdAt");
