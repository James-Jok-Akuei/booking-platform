/**
 * "Rwanda today" (§310): facts, never sentences — the apps say each in their
 * reader's language, as notices do (§308.1). Each item has a `kind` and only
 * the fields its kind needs.
 */

export class TodayBranchDto {
  id!: string;
  name!: string;
  /** Already closed, or with a break, at that time. */
  covered!: boolean;
}

export class TodayRateDto {
  /** USD, EUR, KES or UGX. */
  code!: string;
  /** Francs for one. */
  rwf!: number;
  /** Since the previous day's figure, in francs; null on the first day. */
  change!: number | null;
}

export class TodayItemDto {
  /** momo · kwibuka · umuganda · holiday · searches · rain · tax · rates · news */
  kind!: string;

  /** momo: how mobile money is doing — "slow" or "down". */
  momo?: string;

  /** kwibuka: the commemoration's number (32 in 2026), and its last day. */
  number?: number;
  until?: string;

  /** umuganda, holiday: the day ("YYYY-MM-DD"); rates: the day they are for; tax: the deadline. */
  date?: string;
  /** holiday: which (new-year, heroes, memorial, …, christmas, eid-al-fitr). */
  holiday?: string;
  /** umuganda, holiday: the branches open then, and whether each is already set for it. */
  branches?: TodayBranchDto[];

  /** searches: the words customers typed, how often this week, where, and whether this shop offers it. */
  term?: string;
  count?: number;
  district?: string;
  offered?: boolean;

  /** rain: the hour heavy rain is expected from ("14:00"), and where. */
  from?: string;

  /** tax: vat-paye (the 15th) · licence (31 January) · annual (31 March). */
  tax?: string;

  /** rates: francs for one dollar, euro, Kenyan and Ugandan shilling, and where they come from. */
  rates?: TodayRateDto[];
  source?: string;
  sourceUrl?: string;

  /** news: written by our team in the console, in the reader's language. */
  newsId?: string;
  title?: string;
  body?: string;
  linkPath?: string | null;
  linkLabel?: string | null;
}

export class TodayDto {
  /** Kwibuka: the apps keep quiet — no festive effects, no discount pushes. */
  calm!: boolean;
  /** Most urgent first. */
  items!: TodayItemDto[];
}

/** For the customer app (§310): what changes how booking goes today, or on a chosen day. */
export class PublicTodayDto {
  calm!: boolean;
  /** ok · slow · down */
  momo!: string;
  /** The day asked about ("YYYY-MM-DD", Kigali). */
  date!: string;
  /** That day is Umuganda: shops open from 11:00. */
  umuganda!: boolean;
  /** That day's public holiday, if any. */
  holiday!: string | null;
}
