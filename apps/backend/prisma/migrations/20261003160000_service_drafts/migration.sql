-- Half-written services, kept so they are not lost (§123).
--
-- A separate table rather than a flag on `services`: a draft in that table would
-- be one forgotten `where` away from a customer seeing a service with no price,
-- and §119 had just finished widening a predicate because that exact filter was
-- missed in two places. A draft cannot leak out of a query it is not in.

CREATE TABLE "service_drafts" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "durationMinutes" INTEGER,
    "depositPercentage" DECIMAL(5,2),
    "offers" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_drafts_businessId_updatedAt_idx" ON "service_drafts"("businessId", "updatedAt");

ALTER TABLE "service_drafts" ADD CONSTRAINT "service_drafts_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_drafts" ADD CONSTRAINT "service_drafts_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
