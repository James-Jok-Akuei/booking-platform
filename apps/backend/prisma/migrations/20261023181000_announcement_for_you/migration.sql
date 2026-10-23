-- An announcement to shops can also be a card in the business app's For you (§310).
ALTER TABLE "announcements" ADD COLUMN "forYouUntil" TIMESTAMP(3);
