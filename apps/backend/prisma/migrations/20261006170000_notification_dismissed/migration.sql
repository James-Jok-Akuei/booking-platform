-- A notification the customer took off their list (§159).
--
-- Marked, not deleted: the row is also the record of an email that was sent
-- (status, sentAt, failureCount) and the retry sweep reads it. The inbox simply
-- stops showing a dismissed one.
ALTER TABLE "notifications" ADD COLUMN "dismissedAt" TIMESTAMP(3);
CREATE INDEX "notifications_recipientId_dismissedAt_readAt_idx"
    ON "notifications"("recipientId", "dismissedAt", "readAt");
