import { MobileMoneyProvider } from '@prisma/client';
import { allPacks } from '../countries/packs';

/**
 * Which mobile money operator a phone number probably belongs to (§58.1).
 *
 * ## Why "probably"
 *
 * Number prefixes were assigned to operators, and in most of Africa still
 * broadly follow them — but mobile number portability means a subscriber can
 * keep their number and change network, so a prefix is a strong default and
 * never a fact. Treating it as a fact would send an ported customer's payment
 * to the wrong operator, where it fails with an unhelpful error.
 *
 * So the rule throughout is: **infer, then let the customer override.** The
 * inference makes the common case one tap; the override makes the uncommon case
 * possible at all. Nothing here is ever the last word.
 *
 * ## Why unknown numbers return null rather than a guess
 *
 * Only prefixes that are actually known are listed. A number in a country with
 * no mapping — or on a prefix nobody has recorded — returns null, and the
 * caller falls back to the single configured operator. Guessing would mean
 * charging the wrong network for a number the platform has never seen, which is
 * worse than admitting ignorance: the caller has a correct fallback available
 * and an invented answer takes it away.
 */

/**
 * National-number prefixes by country calling code — each country's own,
 * from its pack (§315): Rwanda's are in `countries/packs/rwanda.ts`.
 *
 * Keyed on the two digits that follow the country code in E.164/MSISDN form —
 * i.e. the national number WITHOUT its leading zero, since international format
 * drops it. A Rwandan 078… is 25078… on the wire, so the prefix there is "78".
 *
 * A country with no pack has no mapping, deliberately: a mapping written from
 * memory would be a guess dressed as a rule.
 */
const OPERATOR_PREFIXES = (): Readonly<Record<string, Readonly<Record<string, MobileMoneyProvider>>>> =>
  Object.fromEntries(allPacks().map((pack) => [pack.callingCode, pack.operatorPrefixes]));

/**
 * The operator a number most likely belongs to, or null if it cannot be told.
 *
 * `msisdn` is digits only, country code first, no plus — the same shape
 * `InitiateDepositPaymentDto` already enforces.
 */
export function inferOperator(msisdn: string): MobileMoneyProvider | null {
  const digits = msisdn.replace(/\D/g, '');

  // Country codes are 1-3 digits and not self-delimiting, so try longest first:
  // "250" must win over "25" for a Rwandan number.
  for (const length of [3, 2, 1]) {
    const country = digits.slice(0, length);
    const prefixes = OPERATOR_PREFIXES()[country];
    if (!prefixes) continue;

    const national = digits.slice(length);
    return prefixes[national.slice(0, 2)] ?? null;
  }

  return null;
}

/** The countries this mapping actually covers, for tests and diagnostics. */
export function routedCountries(): string[] {
  return Object.keys(OPERATOR_PREFIXES());
}
