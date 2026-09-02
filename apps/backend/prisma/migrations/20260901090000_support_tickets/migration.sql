-- Support tickets.
--
-- Parallel to Chat rather than built on it: the participants are a reporter and
-- the platform's admins, and tickets carry status, assignment and resolution
-- that a chat thread has no notion of.

-- AlterEnum: notification types for the ticket lifecycle.
ALTER TYPE "NotificationType" ADD VALUE 'TICKET_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'TICKET_MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'TICKET_STATUS_CHANGED';

-- CreateEnum
CREATE TYPE "ReporterType" AS ENUM ('CUSTOMER', 'BUSINESS');
CREATE TYPE "TicketCategory" AS ENUM ('PAYMENT_ISSUE', 'APPOINTMENT_DISPUTE', 'ACCOUNT_ISSUE', 'TECHNICAL_ISSUE', 'OTHER');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "TicketAuthorType" AS ENUM ('REPORTER', 'ADMIN');
CREATE TYPE "BillingAdjustmentType" AS ENUM ('FEE_CREDIT', 'FEE_CHARGE');

-- Reference numbers come from a sequence, not from counting existing rows.
-- A count-and-increment read is not collision-safe: two concurrent creates read
-- the same count and mint the same reference. nextval() is atomic and never
-- returns the same value twice, even under rollback.
CREATE SEQUENCE "ticket_reference_seq" START WITH 1 INCREMENT BY 1;

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reporterType" "ReporterType" NOT NULL,
    "businessId" TEXT,
    "appointmentId" TEXT,
    "category" "TicketCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "assignedAdminId" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorType" "TicketAuthorType" NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketMessageId" TEXT,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_adjustments" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "ticketId" TEXT,
    "type" "BillingAdjustmentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "appliedInvoiceId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_reference_key" ON "tickets"("reference");
CREATE INDEX "tickets_status_lastMessageAt_idx" ON "tickets"("status", "lastMessageAt");
CREATE INDEX "tickets_reporterId_idx" ON "tickets"("reporterId");
CREATE INDEX "tickets_businessId_idx" ON "tickets"("businessId");
CREATE INDEX "ticket_messages_ticketId_createdAt_idx" ON "ticket_messages"("ticketId", "createdAt");
CREATE INDEX "ticket_attachments_ticketId_idx" ON "ticket_attachments"("ticketId");
-- The query a future invoice run makes: one business's unapplied adjustments.
CREATE INDEX "billing_adjustments_businessId_appliedInvoiceId_idx" ON "billing_adjustments"("businessId", "appliedInvoiceId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull, not Cascade: a dispute about an appointment must outlive the
-- appointment record it disputes.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticketMessageId_fkey" FOREIGN KEY ("ticketMessageId") REFERENCES "ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
