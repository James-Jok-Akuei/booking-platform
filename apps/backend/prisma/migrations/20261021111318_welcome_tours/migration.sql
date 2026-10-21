-- AlterTable
ALTER TABLE "users" ADD COLUMN     "toursDue" TEXT[] DEFAULT ARRAY[]::TEXT[];

