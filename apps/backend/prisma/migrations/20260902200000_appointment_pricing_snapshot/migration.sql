-- Snapshot the pricing inputs on Appointment.
--
-- depositAmountCents, platformFeeAmountCents and businessAmountCents were
-- already snapshotted; the values they were derived FROM were not. Service
-- price and deposit percentage are editable, and the platform fee percentage is
-- a live admin setting, so a historical appointment could not be explained or
-- reconstructed afterwards.
--
-- This migration changes no money. It adds three columns that record inputs
-- already in use at booking time.
--
-- Deliberately NULLABLE with NO BACKFILL. Existing rows genuinely do not carry
-- this information and it cannot be recovered: the equations have two unknowns
-- (price and percentages) and both sides have since been editable. Writing a
-- guessed value would turn "unknown" into "wrong", which is worse.

-- AlterTable
ALTER TABLE "appointments"
    ADD COLUMN "servicePriceCents"     INTEGER,
    ADD COLUMN "depositPercentage"     DECIMAL(5,2),
    ADD COLUMN "platformFeePercentage" DECIMAL(5,2);
