-- Chat: threads, messages and per-person read state.
--
-- Two constraints below cannot be expressed in schema.prisma and are written by
-- hand: the partial unique index on inquiry threads, and the CHECK that a
-- message carries some content.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'NEW_MESSAGE';

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_read_states" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "lastNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "thread_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: at most one thread per appointment. A plain unique index is
-- enough — Postgres treats NULLs as distinct, so inquiry threads (which have no
-- appointment) are unconstrained by it.
CREATE UNIQUE INDEX "threads_appointmentId_key" ON "threads"("appointmentId");

-- CreateIndex
CREATE INDEX "threads_businessProfileId_lastMessageAt_idx" ON "threads"("businessProfileId", "lastMessageAt");
CREATE INDEX "threads_customerId_lastMessageAt_idx" ON "threads"("customerId", "lastMessageAt");

-- CreateIndex: EXACTLY ONE inquiry thread per customer-business pair.
--
-- Partial, because the rule applies only to inquiry threads: a customer may
-- also have any number of appointment-scoped threads with the same business,
-- one per booking. Prisma's DSL has no WHERE clause for indexes, so this is
-- hand-written — the same pattern, and the same caveat, as
-- "business_memberships_active_userId_key" (§15.2).
--
-- Enforcing it here rather than only in the service means a race between two
-- simultaneous inquiry requests cannot produce two threads.
CREATE UNIQUE INDEX "threads_inquiry_customer_business_key"
  ON "threads" ("customerId", "businessProfileId")
  WHERE "appointmentId" IS NULL;

-- CreateIndex
CREATE INDEX "messages_threadId_createdAt_idx" ON "messages"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "thread_read_states_threadId_userId_key" ON "thread_read_states"("threadId", "userId");
CREATE INDEX "thread_read_states_userId_idx" ON "thread_read_states"("userId");

-- A message must carry something. The service rejects empty messages with a
-- clear error; this makes the rule true of the table itself, however a row
-- arrives. NULLIF collapses whitespace-only bodies to NULL so " " is not
-- treated as content.
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_not_empty"
  CHECK (NULLIF(BTRIM("body"), '') IS NOT NULL OR "photoUrl" IS NOT NULL);

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "threads" ADD CONSTRAINT "threads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "threads" ADD CONSTRAINT "threads_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_read_states" ADD CONSTRAINT "thread_read_states_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_read_states" ADD CONSTRAINT "thread_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
