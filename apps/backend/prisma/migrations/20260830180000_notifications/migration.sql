-- Notifications.
--
-- Messages are stored, not fired and forgotten: the row is both the in-app
-- inbox and the audit trail of what a recipient was actually told.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPOINTMENT_BOOKED', 'DEPOSIT_CONFIRMED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_NO_SHOW', 'DEPOSIT_FAILED', 'APPOINTMENT_REMINDER', 'BUSINESS_INVITATION');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable: dedup marker for the reminder sweep. Nullable with no backfill —
-- NULL correctly means "not yet reminded" for every existing appointment.
ALTER TABLE "appointments" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "appointmentId" TEXT,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the inbox query — one recipient, newest first.
CREATE INDEX "notifications_recipientId_createdAt_idx" ON "notifications"("recipientId", "createdAt");

-- CreateIndex: the retry sweep — everything not yet delivered.
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- AddForeignKey: a deleted account's notifications are of no use to anyone.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: SetNull, not Cascade — a notification is evidence that
-- something was communicated, and should outlive what it referred to.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
