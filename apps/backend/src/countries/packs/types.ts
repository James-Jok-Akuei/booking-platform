import type { BusinessDocumentKind, MobileMoneyProvider } from '@prisma/client';
import type { PaperRule } from '../../business/document-rules';

/**
 * What the code knows about a country (§315), beside what its row says.
 *
 * The row holds settings — its clock, money, calling code, networks, languages
 * — which the console shows and which never change behaviour by themselves.
 * The pack holds what is written as code: how its mobile numbers are shaped
 * and which network each belongs to, which trades need a licence and which
 * papers prove registration, and the days its shops plan around. A country
 * cannot be switched on without one (`CountryGuard`), so a new country is
 * added by writing its pack, never by typing settings into the console.
 */
export interface CountryPack {
  /** The country's ISO code, the key of its row. */
  code: string;

  /**
   * Its calling code, digits only — the same as its row's; `CountryGuard`
   * checks the two agree. Here too so a number can be told apart by country
   * without asking the database.
   */
  callingCode: string;

  /**
   * The country's box on the map, "west,south,east,north", for the address
   * search (§172): it takes in a little of each neighbour, so results are
   * filtered to the country as well.
   */
  mapBox: string;

  /** How many digits a mobile number has after the calling code: 9 in Rwanda (78x xxx xxx). */
  mobileDigits: number;

  /**
   * The network a mobile number most likely belongs to (§58.1), keyed on the
   * two digits after the calling code. Only prefixes actually known: a number
   * on any other prefix is left to the customer to say, never guessed.
   */
  operatorPrefixes: Readonly<Record<string, MobileMoneyProvider>>;

  /** Business papers (§314). */
  papers: {
    /** Which kinds of shop must hold a licence. No `types`: every type of the category. */
    rules: ReadonlyArray<{ category: string; types?: string[]; rule: PaperRule }>;
    /** The papers that earn the "Registered business" mark once checked. */
    registration: readonly BusinessDocumentKind[];
    /** Every paper a shop there may upload. */
    kinds: readonly BusinessDocumentKind[];
  };

  /** The days a shop there plans around (§310); absent, For you says none of them. */
  calendar?: CountryCalendar;
}

/** A date as "YYYY-MM-DD", on the country's own clock. */
export type Ymd = string;

export interface CountryCalendar {
  /** The public holiday on `date`, by its key (the apps hold its name). */
  holidayOn(date: Ymd): { date: Ymd; key: string } | null;
  /** The next public holiday from `date` within `withinDays`. */
  nextHoliday(date: Ymd, withinDays: number): { date: Ymd; key: string } | null;
  /** A national morning of community work, when shops stay shut — Rwanda's Umuganda. */
  communityWork?: {
    hours: { from: string; to: string };
    /** The next one on or after `date`. */
    next(date: Ymd): Ymd;
    /** Whether `date` is one. */
    on(date: Ymd): boolean;
  };
  /** A national period of remembrance, when the apps go calm — Rwanda's Kwibuka. */
  remembrance?(date: Ymd): { number: number; from: Ymd; to: Ymd } | null;
  /** A tax date close enough to remind those who see the money about. */
  taxDue?(date: Ymd): { tax: string; date: Ymd } | null;
}
