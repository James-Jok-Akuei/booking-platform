-- Adds the full appointment lifecycle to the AppointmentStatus enum.
--
-- SPLIT DELIBERATELY from the migration that uses these values. Postgres allows
-- ALTER TYPE ... ADD VALUE inside a transaction block (12+), but the new value
-- cannot be USED in that same transaction — and Prisma wraps each migration in
-- one. The next migration sets appointments.status DEFAULT 'PENDING_PAYMENT',
-- which would fail with "unsafe use of new value of enum type" if it ran here.
-- Being its own migration makes it its own transaction, so the values are
-- committed before anything references them.

-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'PENDING_PAYMENT';
ALTER TYPE "AppointmentStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "AppointmentStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "AppointmentStatus" ADD VALUE 'NO_SHOW';
