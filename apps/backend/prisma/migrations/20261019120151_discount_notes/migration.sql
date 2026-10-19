-- §288: what each service's followers were last told about lives in its own
-- table, so the service's own API never carries it.

-- CreateTable
CREATE TABLE "discount_notes" (
    "serviceId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "endsOn" DATE,
    "toldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_notes_pkey" PRIMARY KEY ("serviceId")
);

-- AddForeignKey
ALTER TABLE "discount_notes" ADD CONSTRAINT "discount_notes_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carried over from the columns that held it for a few minutes.
INSERT INTO "discount_notes" ("serviceId", "percent", "endsOn")
SELECT "id", "discountToldPercent", "discountToldEndsOn" FROM "services" WHERE "discountToldPercent" IS NOT NULL;

-- AlterTable
ALTER TABLE "services" DROP COLUMN "discountToldEndsOn",
DROP COLUMN "discountToldPercent";
