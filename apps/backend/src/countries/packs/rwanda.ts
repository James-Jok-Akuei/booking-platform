import { BusinessDocumentKind as K, MobileMoneyProvider } from '@prisma/client';
import type { PaperRule } from '../../business/document-rules';
import { UMUGANDA_HOURS, holidayOn, kwibuka, nextHoliday, nextUmuganda, umugandaIn } from '../../today/rwanda-calendar';
import type { CountryPack, Ymd } from './types';

/**
 * Rwanda (§315): everything about the country that is code rather than a
 * setting. Its row holds the rest — Africa/Kigali, RWF, +250, MTN and Airtel,
 * English, Kinyarwanda and French.
 */

/**
 * The network a Rwandan number belongs to, by the two digits after 250.
 * Airtel absorbed Tigo, which is why it holds 72 as well as 73. Numbers
 * move between networks (portability), so this is a strong default the
 * customer can override, never a fact (§58.1).
 */
const OPERATOR_PREFIXES = {
  '78': MobileMoneyProvider.MTN_MOMO,
  '79': MobileMoneyProvider.MTN_MOMO,
  '72': MobileMoneyProvider.AIRTEL_MONEY,
  '73': MobileMoneyProvider.AIRTEL_MONEY,
} as const;

/** The licences (§314), and the bodies that issue them. */
const HEALTH: PaperRule = { key: 'health', kinds: [K.HEALTH_FACILITY_LICENCE, K.PROFESSIONAL_LICENCE] };
const VETERINARY: PaperRule = { key: 'veterinary', kinds: [K.PROFESSIONAL_LICENCE, K.HEALTH_FACILITY_LICENCE] };
const TOURISM: PaperRule = { key: 'tourism', kinds: [K.TOURISM_LICENCE] };
const LEGAL: PaperRule = { key: 'legal', kinds: [K.BAR_MEMBERSHIP] };

/**
 * Which kinds of shop must hold a licence before they go live. Keyed by the
 * category and type NAMES the seed uses (§266); a test keeps them in step.
 */
const PAPER_RULES = [
  { category: 'Health & Medical', rule: HEALTH },
  {
    category: 'Wellness',
    types: ['Acupuncture', 'Diet & Nutrition', 'Chiropractic', 'Therapy', 'Physiotherapy & Rehab'],
    rule: HEALTH,
  },
  { category: 'Pet Services', types: ['Veterinary Clinic'], rule: VETERINARY },
  { category: 'Tours & Experiences', rule: TOURISM },
  { category: 'Hotels & Stays', types: ['Hotel Rooms', 'Guesthouses & Lodges', 'Apartments & Short Stays'], rule: TOURISM },
  { category: 'Services', types: ['Legal Consultation'], rule: LEGAL },
];

/**
 * RRA's dates worth a card for whoever sees the money (§310): the trading
 * licence (ipatanti) through January, the annual return in late March, and
 * VAT and PAYE in the week before the 15th of every month.
 */
export function rwandaTaxDue(today: Ymd): { tax: string; date: Ymd } | null {
  const [y, m, d] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (m === 1) return { tax: 'licence', date: `${y}-01-31` };
  if (m === 3 && d > 15) return { tax: 'annual', date: `${y}-03-31` };
  if (d >= 8 && d <= 15) return { tax: 'vat-paye', date: `${y}-${pad(m)}-15` };
  return null;
}

export const RWANDA: CountryPack = {
  code: 'RW',
  callingCode: '250',
  mapBox: '28.85,-2.85,30.9,-1.04',
  mobileDigits: 9,
  operatorPrefixes: OPERATOR_PREFIXES,
  papers: {
    rules: PAPER_RULES,
    registration: [K.RDB_CERTIFICATE, K.TIN_CERTIFICATE, K.TRADING_LICENCE],
    kinds: [
      K.RDB_CERTIFICATE,
      K.TIN_CERTIFICATE,
      K.TRADING_LICENCE,
      K.HEALTH_FACILITY_LICENCE,
      K.PROFESSIONAL_LICENCE,
      K.FDA_LICENCE,
      K.TOURISM_LICENCE,
      K.BAR_MEMBERSHIP,
      K.OTHER,
    ],
  },
  calendar: {
    holidayOn,
    nextHoliday,
    communityWork: {
      hours: UMUGANDA_HOURS,
      next: nextUmuganda,
      on: (date) => umugandaIn(Number(date.slice(0, 4)), Number(date.slice(5, 7))) === date,
    },
    remembrance: kwibuka,
    taxDue: rwandaTaxDue,
  },
};
