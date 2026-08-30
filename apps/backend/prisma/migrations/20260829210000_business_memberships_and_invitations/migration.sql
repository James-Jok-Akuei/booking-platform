-- Multi-person business accounts.
--
-- Replaces the one-user-one-business 1:1 relation
-- (business_profiles.userId) with a BusinessMembership join table carrying a
-- role per person.
--
-- ORDER MATTERS. The tables are created and BACKFILLED FIRST, and only then is
-- business_profiles.userId dropped. Prisma's generated diff does the reverse,
-- which would silently orphan every existing business: the column is the only
-- record of who owns what, so dropping it before copying it out destroys the
-- link with no way to reconstruct it.

-- CreateEnum
CREATE TYPE "BusinessMemberRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "BusinessMemberStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateTable
CREATE TABLE "business_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "role" "BusinessMemberRole" NOT NULL,
    "status" "BusinessMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_invitations" (
    "id" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "BusinessMemberRole" NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_memberships_userId_key" ON "business_memberships"("userId");

-- CreateIndex
CREATE INDEX "business_memberships_businessProfileId_status_idx" ON "business_memberships"("businessProfileId", "status");

-- CreateIndex
CREATE INDEX "business_invitations_email_status_idx" ON "business_invitations"("email", "status");

-- CreateIndex
CREATE INDEX "business_invitations_businessProfileId_status_idx" ON "business_invitations"("businessProfileId", "status");

-- AddForeignKey
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BACKFILL: every existing business_profiles.userId becomes an ACTIVE OWNER
-- membership. This runs BEFORE the column is dropped. Every business that
-- existed under the old model keeps exactly the person who owned it, with the
-- role that matches what they could already do.
INSERT INTO "business_memberships" ("id", "userId", "businessProfileId", "role", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), bp."userId", bp."id", 'OWNER', 'ACTIVE', bp."createdAt", NOW()
FROM "business_profiles" bp
WHERE bp."userId" IS NOT NULL;

-- Now, and only now, the old relation can go.
-- DropForeignKey
ALTER TABLE "business_profiles" DROP CONSTRAINT "business_profiles_userId_fkey";

-- DropIndex
DROP INDEX "business_profiles_userId_key";

-- AlterTable
ALTER TABLE "business_profiles" DROP COLUMN "userId";
