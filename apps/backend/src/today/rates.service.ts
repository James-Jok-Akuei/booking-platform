import { Injectable, Logger } from '@nestjs/common';

/**
 * Today's exchange rates in a country's money (§310, §315), for shops that
 * buy supplies abroad or price in dollars. From ExchangeRate-API's free daily
 * rates — market rates, said so on the card with the source, NOT a central
 * bank's official ones: BNR gives its rates feed only on application by a
 * registered company, which this is not yet. When it is, `fetch` below is
 * the one thing to change. Read at most every six hours; yesterday's figures
 * are kept to say which way a rate moved. Any failure is no card, never an
 * error.
 */

/** The monies shown, in this order, leaving out the country's own. */
export const RATE_CODES = ['USD', 'EUR', 'KES', 'UGX', 'RWF'] as const;
export type RateCode = (typeof RATE_CODES)[number];
/** How many rates a card shows. */
const SHOWN = 4;

export type RatesToday = {
  /** The day the rates are for, as the source dates them. */
  date: string;
  /** The country's money the rates are in: "RWF". */
  currency: string;
  /** How much of `currency` one of each buys, and the change since the previous day (null on the first). */
  rates: Array<{ code: RateCode; local: number; change: number | null }>;
  source: string;
  sourceUrl: string;
};

/** Units of each money for one US dollar, as the source gives them. */
type PerDollar = Record<string, number>;

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  private latest: { at: number; date: string; perDollar: PerDollar } | null = null;
  private previous: { date: string; perDollar: PerDollar } | null = null;

  /** Today's rates in `currency` — the shop's country's money. */
  async today(currency: string, now = Date.now()): Promise<RatesToday | null> {
    if (process.env.NODE_ENV === 'test' || process.env.TODAY_FEEDS === 'off') return null;
    if (!this.latest || now - this.latest.at > 6 * 3_600_000) {
      const fresh = await this.fetch();
      if (fresh) {
        if (this.latest && this.latest.date !== fresh.date) this.previous = { date: this.latest.date, perDollar: this.latest.perDollar };
        this.latest = { at: now, ...fresh };
      } else if (this.latest) {
        // Keep the last good figures for a while rather than nothing.
        this.latest.at = now - 5 * 3_600_000;
      }
    }
    if (!this.latest) return null;
    return ratesIn(currency, this.latest, this.previous);
  }

  private async fetch(): Promise<{ date: string; perDollar: PerDollar } | null> {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { result?: string; time_last_update_unix?: number; rates?: Record<string, number> };
      if (body.result !== 'success' || !body.rates) throw new Error('no rates');
      const date = new Date((body.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);
      return { date, perDollar: body.rates };
    } catch (error) {
      this.logger.warn(`Exchange rates could not be read: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}

/**
 * The rates in `currency`, from units-per-dollar figures: one X buys
 * perDollar[currency] / perDollar[X] of it. Null when the source does not
 * know the country's money, or one of the shown ones.
 */
export function ratesIn(
  currency: string,
  latest: { date: string; perDollar: PerDollar },
  previous: { perDollar: PerDollar } | null,
): RatesToday | null {
  const own = latest.perDollar[currency];
  if (!own || !Number.isFinite(own)) return null;
  const codes = RATE_CODES.filter((code) => code !== currency).slice(0, SHOWN);
  const value = (perDollar: PerDollar, code: string) => round(perDollar[currency] / (perDollar[code] ?? NaN));
  const rates = codes.map((code) => {
    const local = value(latest.perDollar, code);
    const before = previous ? value(previous.perDollar, code) : NaN;
    return { code, local, change: Number.isFinite(before) ? round(local - before) : null };
  });
  if (rates.some((r) => !Number.isFinite(r.local))) return null;
  return { date: latest.date, currency, rates, source: 'ExchangeRate-API', sourceUrl: 'https://www.exchangerate-api.com' };
}

/** To two decimals: a shilling is worth about ten francs, a dollar about 1,450. */
const round = (n: number) => Math.round(n * 100) / 100;
