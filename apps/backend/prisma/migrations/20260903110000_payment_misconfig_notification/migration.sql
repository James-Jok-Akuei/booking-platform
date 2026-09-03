-- Admins are told when the platform cannot take payments (§52.2).
--
-- A provider CONFIGURATION failure — wrong currency, bad credential, wrong
-- target environment — will not fix itself and affects every customer, but
-- until now it reached nobody: the customer saw a generic "provider rejected
-- the request" and the real cause lived only in a server log.
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_PROVIDER_MISCONFIGURED';
