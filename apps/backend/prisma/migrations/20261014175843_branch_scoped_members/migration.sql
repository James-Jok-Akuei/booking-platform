-- Members look after all branches, or the ones the owner chooses (§277).
--
-- Every existing member keeps every branch (allLocations defaults to true), so
-- nobody loses anything they could see before. Invitations carry the branches
-- chosen for the invitee; questions asked from a branch's page remember it.

-- AlterTable
ALTER TABLE "business_invitations" ADD COLUMN     "allLocations" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "locationIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "business_memberships" ADD COLUMN     "allLocations" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "locationId" TEXT;

-- CreateTable
CREATE TABLE "membership_locations" (
    "membershipId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_locations_pkey" PRIMARY KEY ("membershipId","locationId")
);

-- CreateIndex
CREATE INDEX "membership_locations_locationId_idx" ON "membership_locations"("locationId");

-- AddForeignKey
ALTER TABLE "membership_locations" ADD CONSTRAINT "membership_locations_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "business_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_locations" ADD CONSTRAINT "membership_locations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
