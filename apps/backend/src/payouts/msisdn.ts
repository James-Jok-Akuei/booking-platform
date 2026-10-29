/**
 * E.164: a leading `+`, a non-zero country code, then 7–14 more digits.
 *
 * Shape only. WHICH country is acceptable is the shop's own (§315): its
 * calling code and how many digits its mobiles have come from its country,
 * checked in the service.
 */
export const E164 = /^\+[1-9]\d{7,14}$/;

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
