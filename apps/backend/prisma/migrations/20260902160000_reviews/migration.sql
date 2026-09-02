-- Reviews, scoped per location.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_RESPONSE';
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_HIDDEN';

-- AlterTable: denormalised aggregates. ratingAvg is deliberately NULL rather
-- than 0 until the first review — "not yet rated" and "rated zero" are
-- different things to show a customer, and 0 is not even a valid rating.
ALTER TABLE "locations"
    ADD COLUMN "ratingAvg" DECIMAL(3,2),
    ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "editedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "hiddenReason" TEXT,
    "hiddenById" TEXT,
    "responseText" TEXT,
    "responseAt" TIMESTAMP(3),
    "responseById" TEXT,
    "responseEditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one review per completed appointment. This is what actually
-- prevents double submission — a read-then-write check loses the race.
CREATE UNIQUE INDEX "reviews_appointmentId_key" ON "reviews"("appointmentId");

-- CreateIndex: the public listing — one location, visible reviews, newest first.
CREATE INDEX "reviews_locationId_hiddenAt_createdAt_idx" ON "reviews"("locationId", "hiddenAt", "createdAt");
CREATE INDEX "reviews_businessId_idx" ON "reviews"("businessId");

-- The 1-5 range is validated in the DTO; this makes it true of the table
-- however a row arrives, the same belt-and-braces as messages_content_not_empty.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range"
  CHECK ("rating" >= 1 AND "rating" <= 5);

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_responseById_fkey" FOREIGN KEY ("responseById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
