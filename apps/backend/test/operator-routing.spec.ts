import { MobileMoneyProvider } from '@prisma/client';
import { inferOperator, routedCountries } from '../src/payments/operator-routing';

/**
 * Sending a payment to the right network (§58.1).
 *
 * The stakes are asymmetric, which is what shapes every case below. Routing to
 * the wrong operator fails in a way the customer cannot act on — their money
 * never moves and the error says nothing useful — while admitting "I cannot
 * tell" costs one tap. So the rules here always prefer null over a guess, and
 * the customer's own choice over both.
 */
describe('Operator routing from a phone number (§58)', () => {
  describe('Rwanda', () => {
    it.each([
      ['250788123456', MobileMoneyProvider.MTN_MOMO],
      ['250790123456', MobileMoneyProvider.MTN_MOMO],
      ['250720123456', MobileMoneyProvider.AIRTEL_MONEY],
      ['250735123456', MobileMoneyProvider.AIRTEL_MONEY],
    ])('routes %s to %s', (msisdn, expected) => {
      expect(inferOperator(msisdn)).toBe(expected);
    });

    it('holds 72 as Airtel, because Airtel absorbed Tigo', () => {
      expect(inferOperator('250721000000')).toBe(MobileMoneyProvider.AIRTEL_MONEY);
    });

    it('returns null for a Rwandan prefix nobody has recorded', () => {
      // 25 is a landline range. Guessing here would charge a network the number
      // does not belong to.
      expect(inferOperator('250250123456')).toBeNull();
    });
  });

  describe('countries with no mapping', () => {
    it('returns null for South Sudan rather than assuming MTN', () => {
      // MTN is the only operator collected through there, so the CALLER falls
      // back to it. The difference matters: a fallback is revisited when a
      // second operator appears; a hardcoded guess is not.
      expect(inferOperator('211920100200')).toBeNull();
      expect(routedCountries()).not.toContain('211');
    });

    it('returns null for a country the platform has never seen', () => {
      expect(inferOperator('447700900000')).toBeNull();
    });
  });

  describe('input it should survive', () => {
    it('tolerates a leading plus and spacing', () => {
      expect(inferOperator('+250 788 123 456')).toBe(MobileMoneyProvider.MTN_MOMO);
    });

    it('returns null for empty or nonsense input instead of throwing', () => {
      expect(inferOperator('')).toBeNull();
      expect(inferOperator('abc')).toBeNull();
      expect(inferOperator('250')).toBeNull();
    });

    it('prefers the longest matching country code', () => {
      // "2" and "25" must not win over "250" for a Rwandan number.
      expect(inferOperator('250788123456')).toBe(MobileMoneyProvider.MTN_MOMO);
    });
  });
});
