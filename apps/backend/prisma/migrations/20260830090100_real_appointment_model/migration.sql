-- The real Appointment model, replacing the §12 placeholder, plus location
-- capacity, service deposit percentage, and the platform settings row.

-- The placeholder Appointment table was never written to: §12 added it purely
-- so availability could subtract booked time, and deliberately shipped no
-- endpoint that inserts into it. The new columns below are NOT NULL with no
-- default, which is only safe because the table is empty. If it somehow is not,
-- stop rather than fail later with an opaque constraint error.
DO $$
DECLARE
  existing INT;
BEGIN
  SELECT COUNT(*) INTO existing FROM "appointments";
  IF existing > 0 THEN
    RAISE EXCEPTION
      'appointments already holds % row(s). The placeholder table was expected to be empty; backfill customerId, serviceId and the three amount columns before applying this migration.', existing;
  END IF;
END $$;

-- AlterTable: locations gain capacity. Explicitly set to 1 for every existing
-- row, which is exactly the behaviour they had when capacity was implicit.
ALTER TABLE "locations" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 1;
UPDATE "locations" SET "capacity" = 1 WHERE "capacity" IS DISTINCT FROM 1;

-- AlterTable: services gain a deposit percentage. The 10.00 default matches
-- the default platform fee, i.e. the lowest value that passes validation.
ALTER TABLE "services" ADD COLUMN "depositPercentage" DECIMAL(5,2) NOT NULL DEFAULT 10.00;

-- CreateTable: single-row platform settings.
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL,
    "platformFeePercentage" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- Seed the one row the application expects. Idempotent, and matches the
-- PLATFORM_SETTING_ID constant in platform-settings.service.ts.
INSERT INTO "platform_settings" ("id", "platformFeePercentage", "updatedAt")
VALUES ('platform', 10.00, NOW())
ON CONFLICT ("id") DO NOTHING;

-- DropForeignKey: serviceId becomes required, and its delete behaviour changes
-- from SetNull to Restrict — a service that has appointments must not be
-- deletable out from under them. Services are soft-deleted anyway (§10).
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_serviceId_fkey";

-- AlterTable: the real appointment.
ALTER TABLE "appointments"
    ADD COLUMN "customerId" TEXT NOT NULL,
    ADD COLUMN "depositAmountCents" INTEGER NOT NULL,
    ADD COLUMN "platformFeeAmountCents" INTEGER NOT NULL,
    ADD COLUMN "businessAmountCents" INTEGER NOT NULL,
    ADD COLUMN "verificationCodeHash" TEXT,
    ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "verifiedAt" TIMESTAMP(3),
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "cancelledAt" TIMESTAMP(3),
    ADD COLUMN "noShowAt" TIMESTAMP(3),
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL,
    ALTER COLUMN "serviceId" SET NOT NULL,
    ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- CreateIndex
CREATE INDEX "appointments_customerId_startTime_idx" ON "appointments"("customerId", "startTime");

-- CreateIndex: drives the auto-transition sweep (status + endTime).
CREATE INDEX "appointments_status_endTime_idx" ON "appointments"("status", "endTime");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
