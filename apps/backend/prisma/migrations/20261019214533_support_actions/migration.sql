-- CreateEnum
CREATE TYPE "SupportActionKind" AS ENUM ('CHECK_IN', 'COMPLETE', 'FIX_NO_SHOW', 'CANCEL_FOR_CUSTOMER', 'CANCEL_FOR_SHOP', 'RESEND_CODE', 'CHECK_PAYMENT', 'READ_MESSAGES', 'PAUSE_SHOP', 'RESUME_SHOP', 'REVOKE_INVITATION', 'RESEND_INVITATION', 'REMOVE_MEMBER', 'TRANSFER_OWNERSHIP', 'SIGN_OUT_EVERYWHERE', 'STOP_MARKETING', 'CLOSE_ACCOUNT', 'LINK_TICKET');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_UPDATE';

-- CreateTable
CREATE TABLE "support_actions" (
    "id" TEXT NOT NULL,
    "kind" "SupportActionKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "appointmentId" TEXT,
    "businessId" TEXT,
    "userId" TEXT,
    "ticketId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_actions_appointmentId_createdAt_idx" ON "support_actions"("appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "support_actions_businessId_createdAt_idx" ON "support_actions"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "support_actions_userId_createdAt_idx" ON "support_actions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "support_actions_ticketId_idx" ON "support_actions"("ticketId");

-- CreateIndex
CREATE INDEX "support_actions_actorId_createdAt_idx" ON "support_actions"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

