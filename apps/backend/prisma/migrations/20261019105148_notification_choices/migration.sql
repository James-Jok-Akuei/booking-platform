-- §287: what each person gets, and how — push, email, choices, announcements,
-- shops' messages to their followers.

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('BOOKINGS', 'REMINDERS', 'MESSAGES', 'REVIEWS', 'MONEY', 'ACCOUNT', 'NEWS', 'SHOP_OFFERS', 'ADMIN_TICKETS', 'ADMIN_QUEUE', 'ADMIN_SYSTEM');

-- CreateEnum
CREATE TYPE "PushDeviceKind" AS ENUM ('EXPO', 'WEB');

-- CreateEnum
CREATE TYPE "AnnouncementKind" AS ENUM ('SERVICE', 'NEWS');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('EVERYONE', 'CUSTOMERS', 'SELLERS', 'ONE_PERSON', 'ONE_SHOP');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'PUSH';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationStatus" ADD VALUE 'SENDING';
ALTER TYPE "NotificationStatus" ADD VALUE 'SKIPPED';
ALTER TYPE "NotificationStatus" ADD VALUE 'HELD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_SENT';
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'ANNOUNCEMENT';
ALTER TYPE "NotificationType" ADD VALUE 'SHOP_MESSAGE';

-- AlterTable: the new columns first; the old delivery columns go once copied (below).
ALTER TABLE "notifications" ADD COLUMN     "announcementId" TEXT,
ADD COLUMN     "category" "NotificationCategory" NOT NULL DEFAULT 'ACCOUNT',
ADD COLUMN     "link" TEXT,
ADD COLUMN     "shopMessageId" TEXT,
ADD COLUMN     "threadId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bookingEmailDigest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quietFrom" INTEGER NOT NULL DEFAULT 1260,
ADD COLUMN     "quietHoursOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quietTo" INTEGER NOT NULL DEFAULT 420;

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "pushTickets" JSONB,
    "receiptsCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("userId","category","channel")
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PushDeviceKind" NOT NULL,
    "token" TEXT NOT NULL,
    "p256dh" TEXT,
    "auth" TEXT,
    "label" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "wording" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "kind" "AnnouncementKind" NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL,
    "districtId" TEXT,
    "categoryId" TEXT,
    "userId" TEXT,
    "businessId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkPath" TEXT,
    "linkLabel" TEXT,
    "sendPush" BOOLEAN NOT NULL DEFAULT true,
    "sendEmail" BOOLEAN NOT NULL DEFAULT false,
    "banner" BOOLEAN NOT NULL DEFAULT false,
    "bannerUntil" TIMESTAMP(3),
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "sentById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_follows" (
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_follows_pkey" PRIMARY KEY ("userId","businessId")
);

-- CreateTable
CREATE TABLE "shop_messages" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT,
    "sentById" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_deliveries_status_dueAt_idx" ON "notification_deliveries"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");

-- CreateIndex
CREATE INDEX "push_devices_userId_idx" ON "push_devices"("userId");

-- CreateIndex
CREATE INDEX "consent_records_userId_purpose_idx" ON "consent_records"("userId", "purpose");

-- CreateIndex
CREATE INDEX "announcements_status_scheduledFor_idx" ON "announcements"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "shop_follows_businessId_idx" ON "shop_follows"("businessId");

-- CreateIndex
CREATE INDEX "shop_messages_businessId_createdAt_idx" ON "shop_messages"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_announcementId_idx" ON "notifications"("announcementId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_shopMessageId_fkey" FOREIGN KEY ("shopMessageId") REFERENCES "shop_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- §287: every notification sent so far was an email, its state kept on the
-- notification itself. It moves to a delivery row. One not sent by now is
-- closed at the attempt limit rather than sent days late (the new values of
-- NotificationStatus cannot be used in the migration that adds them).
INSERT INTO "notification_deliveries" ("id", "notificationId", "channel", "status", "dueAt", "attempts", "lastError", "sentAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, n."id", n."channel",
       CASE WHEN n."status" = 'SENT' THEN 'SENT'::"NotificationStatus" ELSE 'FAILED'::"NotificationStatus" END,
       n."createdAt",
       CASE WHEN n."status" = 'SENT' THEN GREATEST(n."failureCount", 1) ELSE 5 END,
       CASE WHEN n."status" = 'SENT' THEN NULL ELSE COALESCE(n."lastError", 'Not sent before §287.') END,
       n."sentAt", n."createdAt", n."updatedAt"
FROM "notifications" n;

-- §287: what each one was about, for the recipient's choices.
UPDATE "notifications" n SET "category" = (CASE
  WHEN u."role" = 'ADMIN' AND n."type" IN ('TICKET_CREATED', 'TICKET_MESSAGE', 'TICKET_STATUS_CHANGED') THEN 'ADMIN_TICKETS'
  WHEN u."role" = 'ADMIN' AND n."type" IN ('EXCHANGE_RATE_STALE', 'PAYMENT_PROVIDER_MISCONFIGURED') THEN 'ADMIN_SYSTEM'
  WHEN u."role" = 'ADMIN' AND n."type" IN ('BUSINESS_SUBMITTED', 'BUSINESS_KIND_WRITTEN', 'PAYOUT_DESTINATION_SUBMITTED', 'APPOINTMENT_MANUALLY_VERIFIED') THEN 'ADMIN_QUEUE'
  WHEN n."type" IN ('APPOINTMENT_BOOKED', 'DEPOSIT_CONFIRMED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_NO_SHOW', 'DEPOSIT_FAILED') THEN 'BOOKINGS'
  WHEN n."type" = 'APPOINTMENT_REMINDER' THEN 'REMINDERS'
  WHEN n."type" = 'NEW_MESSAGE' THEN 'MESSAGES'
  WHEN n."type" IN ('REVIEW_CREATED', 'REVIEW_RESPONSE', 'REVIEW_HIDDEN') THEN 'REVIEWS'
  WHEN n."type" IN ('PAYOUT_DESTINATION_VERIFIED', 'PAYOUT_DESTINATION_REJECTED') THEN 'MONEY'
  ELSE 'ACCOUNT'
END)::"NotificationCategory"
FROM "users" u WHERE u."id" = n."recipientId";

-- The old delivery columns, now copied.
DROP INDEX "notifications_status_idx";
ALTER TABLE "notifications" DROP COLUMN "channel",
DROP COLUMN "failureCount",
DROP COLUMN "lastError",
DROP COLUMN "sentAt",
DROP COLUMN "status";

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_messages" ADD CONSTRAINT "shop_messages_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_messages" ADD CONSTRAINT "shop_messages_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_messages" ADD CONSTRAINT "shop_messages_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

