import { Injectable, Logger } from '@nestjs/common';

/**
 * Today's exchange rates in francs (§310), for shops that buy supplies abroad
 * or price in dollars. From ExchangeRate-API's free daily rates — market
 * rates, said so on the card with the source, NOT the National Bank's official
 * ones: BNR gives its rates feed only on application by a registered company,
 * which this is not yet. When it is, `fetch` below is the one thing to change.
 *
 * Read at most every six hours; yesterday's figures are kept to say which way
 * a rate moved. Any failure is no card, never an error.
 */
export const RATE_CODES = ['USD', 'EUR', 'KES', 'UGX'] as const;
export type RateCode = (typeof RATE_CODES)[number];
export type RatesToday = {
  /** The day the rates are for, as the source dates them. */
  date: string;
  /** Francs for one of each. */
  rwf: Record<RateCode, number>;
  /** The change since the previous day's figure, in francs; null on the first day. */
  change: Record<RateCode, number | null>;
  source: string;
  sourceUrl: string;
};

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  private latest: { at: number; date: string; rwf: Record<RateCode, number> } | null = null;
  private previous: { date: string; rwf: Record<RateCode, number> } | null = null;

  async today(now = Date.now()): Promise<RatesToday | null> {
    if (process.env.NODE_ENV === 'test' || process.env.TODAY_FEEDS === 'off') return null;
    if (!this.latest || now - this.latest.at > 6 * 3_600_000) {
      const fresh = await this.fetch();
      if (fresh) {
        if (this.latest && this.latest.date !== fresh.date) this.previous = { date: this.latest.date, rwf: this.latest.rwf };
        this.latest = { at: now, ...fresh };
      } else if (this.latest) {
        // Keep the last good figures for a while rather than nothing.
        this.latest.at = now - 5 * 3_600_000;
      }
    }
    if (!this.latest) return null;
    const { date, rwf } = this.latest;
    const change = Object.fromEntries(
      RATE_CODES.map((code) => [code, this.previous ? round(rwf[code] - this.previous.rwf[code]) : null]),
    ) as Record<RateCode, number | null>;
    return { date, rwf, change, source: 'ExchangeRate-API', sourceUrl: 'https://www.exchangerate-api.com' };
  }

  private async fetch(): Promise<{ date: string; rwf: Record<RateCode, number> } | null> {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { result?: string; time_last_update_unix?: number; rates?: Record<string, number> };
      const r = body.rates;
      if (body.result !== 'success' || !r?.RWF) throw new Error('no RWF rate');
      const rwf = Object.fromEntries(RATE_CODES.map((code) => [code, round(r.RWF / (r[code] ?? NaN))])) as Record<RateCode, number>;
      if (RATE_CODES.some((code) => !Number.isFinite(rwf[code]))) throw new Error('a rate is missing');
      const date = new Date((body.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);
      return { date, rwf };
    } catch (error) {
      this.logger.warn(`Exchange rates could not be read: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}

/** To two decimals: a shilling is worth about ten francs, a dollar about 1,450. */
const round = (n: number) => Math.round(n * 100) / 100;
