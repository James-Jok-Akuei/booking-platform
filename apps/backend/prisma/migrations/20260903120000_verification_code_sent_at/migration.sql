-- Say that an arrival code was sent (§53.2).
--
-- A TIMESTAMP, never the code itself — the code is emailed and stored only as a
-- bcrypt hash, and that stays true. This records only that one went out, so a
-- client can tell the customer to expect it and a customer who received nothing
-- knows something is wrong.
ALTER TABLE "appointments" ADD COLUMN "verificationCodeSentAt" TIMESTAMP(3);
