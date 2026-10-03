-- A picture, and the numbers somebody pays from (§124).

ALTER TABLE "users" ADD COLUMN "imageUrl" TEXT;

-- NOT a stored credential. MTN charges by prompting the handset, so there is
-- nothing here that could be used without the person holding the phone. The
-- number is still sent to the same endpoint and validated by the same DTO —
-- this saves retyping, and nothing else.
CREATE TABLE "saved_payment_numbers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "provider" "MobileMoneyProvider",
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "saved_payment_numbers_pkey" PRIMARY KEY ("id")
);

-- Saving the same number twice is saving it once.
CREATE UNIQUE INDEX "saved_payment_numbers_userId_phoneNumber_key"
    ON "saved_payment_numbers"("userId", "phoneNumber");
CREATE INDEX "saved_payment_numbers_userId_lastUsedAt_idx"
    ON "saved_payment_numbers"("userId", "lastUsedAt");

ALTER TABLE "saved_payment_numbers" ADD CONSTRAINT "saved_payment_numbers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
