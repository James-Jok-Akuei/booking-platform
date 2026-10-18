-- Shops' stories (§285): one photo and a few words, for 24 hours, and
-- customers' reports of them. A new notice for a story an admin took down.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'STORY_REMOVED';

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT,
    "createdById" TEXT,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removedReason" TEXT,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_reports" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stories_expiresAt_idx" ON "stories"("expiresAt");

-- CreateIndex
CREATE INDEX "stories_businessId_createdAt_idx" ON "stories"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "story_reports_storyId_idx" ON "story_reports"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "story_reports_storyId_reporterId_key" ON "story_reports"("storyId", "reporterId");

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_reports" ADD CONSTRAINT "story_reports_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_reports" ADD CONSTRAINT "story_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

