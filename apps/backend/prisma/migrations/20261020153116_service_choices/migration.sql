-- CreateEnum
CREATE TYPE "ChoiceKind" AS ENUM ('ONE', 'MANY');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CHOICES_CHANGED';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "choices" JSONB,
ADD COLUMN     "choicesChangedAt" TIMESTAMP(3),
ADD COLUMN     "choicesMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "choicesPriceMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "customerNote" TEXT,
ADD COLUMN     "healthChoicesRemovedAt" TIMESTAMP(3),
ADD COLUMN     "healthChoicesSealed" TEXT;

-- AlterTable
ALTER TABLE "service_drafts" ADD COLUMN     "choices" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "noteEnabled" BOOLEAN,
ADD COLUMN     "notePrompt" TEXT,
ADD COLUMN     "priceConfirmedAtShop" BOOLEAN;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "noteEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notePrompt" TEXT,
ADD COLUMN     "priceConfirmedAtShop" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "service_choice_groups" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "question" TEXT,
    "kind" "ChoiceKind" NOT NULL DEFAULT 'ONE',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "maxPicks" INTEGER,
    "healthRelated" BOOLEAN NOT NULL DEFAULT false,
    "showIfOptionId" TEXT,
    "suggestionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_choice_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_choice_options" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "extraMinutes" INTEGER NOT NULL DEFAULT 0,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_choice_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_choice_groups_serviceId_position_idx" ON "service_choice_groups"("serviceId", "position");

-- CreateIndex
CREATE INDEX "service_choice_options_groupId_position_idx" ON "service_choice_options"("groupId", "position");

-- AddForeignKey
ALTER TABLE "service_choice_groups" ADD CONSTRAINT "service_choice_groups_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_choice_groups" ADD CONSTRAINT "service_choice_groups_showIfOptionId_fkey" FOREIGN KEY ("showIfOptionId") REFERENCES "service_choice_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_choice_options" ADD CONSTRAINT "service_choice_options_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "service_choice_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- hand (§300): the ranges the service rules keep, held by the table too.
ALTER TABLE "service_choice_groups"
    ADD CONSTRAINT "service_choice_groups_max_picks_check" CHECK ("maxPicks" IS NULL OR "maxPicks" >= 1);

ALTER TABLE "service_choice_options"
    ADD CONSTRAINT "service_choice_options_amounts_check" CHECK (
        "extraMinutes" >= 0 AND "extraMinutes" <= 480
        AND "priceMinor" >= -100000000 AND "priceMinor" <= 100000000
    );

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_choices_check" CHECK (
        "choicesMinutes" >= 0
        AND ("customerNote" IS NULL OR char_length("customerNote") <= 250)
    );
