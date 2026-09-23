/**
 * E.164: a leading `+`, a non-zero country code, then 7–14 more digits.
 *
 * Shape only. WHICH country is acceptable is configurable and lives in the
 * service (§48.2), because a hardcoded prefix is a decision that has to be
 * redeployed the first time the platform crosses a border — and the same
 * mistake was already avoided for the platform timezone (§12).
 */
export const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * The default expected country prefix: Rwanda (§66).
 *
 * A DEFAULT, not a rule — `PAYOUT_MSISDN_COUNTRY_PREFIX` overrides it, which
 * is what makes a second country a configuration change rather than a
 * redeploy of edited source.
 */
export const DEFAULT_MSISDN_COUNTRY_PREFIX = '+250';

/**
 * The last `count` digits, for showing a number to someone who may not see all
 * of it.
 *
 * Enough for the holder to recognise their own number, not enough for anyone
 * else to dial it — which is the whole point of showing a business's staff the
 * status of a payout number without showing them where the money goes (§48.4).
 */
export function maskMsisdn(msisdn: string, count = 3): string {
  const tail = msisdn.slice(-count);
  return `${'•'.repeat(Math.max(msisdn.length - count, 0))}${tail}`;
}
