-- Sales on services (§186): a whole percentage off every branch's price,
-- optionally until a last day. On the draft too, so it is not lost while being
-- written. And on the appointment, what the sale was when it was booked.
ALTER TABLE "services" ADD COLUMN "discountPercent" INTEGER;
ALTER TABLE "services" ADD COLUMN "discountEndsOn" DATE;
ALTER TABLE "services" ADD CONSTRAINT "services_discount_percent_range"
  CHECK ("discountPercent" IS NULL OR ("discountPercent" >= 1 AND "discountPercent" <= 90));
ALTER TABLE "services" ADD CONSTRAINT "services_discount_end_needs_percent"
  CHECK ("discountEndsOn" IS NULL OR "discountPercent" IS NOT NULL);

ALTER TABLE "service_drafts" ADD COLUMN "discountPercent" INTEGER;
ALTER TABLE "service_drafts" ADD COLUMN "discountEndsOn" DATE;

ALTER TABLE "appointments" ADD COLUMN "discountPercent" INTEGER;
ALTER TABLE "appointments" ADD COLUMN "listPriceMinor" INTEGER;
