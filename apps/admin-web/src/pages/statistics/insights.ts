import type { StatisticsPeriod } from '../../api/admin';
import type { IconName } from '../../ui/Icon';
import { busiest } from './charts';

/** Where on the page an insight's figures are, for its "See" link. */
export type SectionId = 'st-all' | 'st-stretch' | 'st-people' | 'st-wants' | 'st-months';

export type Insight = {
  key: string;
  tone: 'up' | 'down' | 'act' | 'info';
  icon: IconName;
  /** Said in bold: the finding itself. */
  lead: string;
  /** The rest of the sentence: what it is measured against, or what to do. */
  rest: string;
  to: SectionId;
  score: number;
  /** Growth findings: at most two of these, so the strip is never only arrows. */
  growth?: true;
};

type Say = { full: (minor: number) => string; count: (n: number) => string };

const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

/**
 * "What changed" (§316): the three things in this stretch most worth a
 * sentence, worked out from the same numbers the page shows — never anything
 * the page does not. Growth when there is a stretch before to grow from; then
 * what to act on (searches that found nothing, bookings never paid for,
 * customers not turning up, one shop carrying the platform); then what is
 * simply good to know. Each is scored, the best three are said.
 */
export function insightsOf(p: StatisticsPeriod, say: Say, stretch: string): Insight[] {
  const t = p.totals;
  const before = p.previous;
  const out: Insight[] = [];
  const hadBefore = !!before && (before.bookings > 0 || before.newCustomers > 0 || before.feesKeptMinor !== 0);

  // ---- growth, against the stretch before
  if (p.compared && before && hadBefore) {
    const grew = (key: string, label: string, now: number, then: number, words: (n: number) => string, weight: number, to: SectionId) => {
      if (then <= 0) return;
      const change = pct(now - then, then);
      if (Math.abs(change) < 10) return;
      out.push({
        key,
        tone: change > 0 ? 'up' : 'down',
        icon: change > 0 ? 'trendUp' : 'trendDown',
        lead: `${label} ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}%`,
        rest: `on the ${p.days} days before — ${words(now)} against ${words(then)}.`,
        to,
        score: Math.min(Math.abs(change), 300) / 4 + weight,
        growth: true,
      });
    };
    grew('bookings', 'Bookings are', t.bookings, before.bookings, say.count, 30, 'st-stretch');
    grew('fees', 'Platform fees kept are', t.feesKeptMinor, before.feesKeptMinor, say.full, 26, 'st-stretch');
    grew('value', 'Booking value is', t.bookingValueMinor, before.bookingValueMinor, say.full, 20, 'st-stretch');
    grew('customers', 'New customers are', t.newCustomers, before.newCustomers, say.count, 12, 'st-people');
  } else if (t.bookings > 0) {
    // Nothing to compare with: say what there is.
    out.push({
      key: 'headline',
      tone: 'info',
      icon: 'sparkles',
      lead: `${say.count(t.bookings)} ${t.bookings === 1 ? 'booking' : 'bookings'} worth ${say.full(t.bookingValueMinor)}`,
      rest: `${stretch}${t.feesKeptMinor > 0 ? `, and ${say.full(t.feesKeptMinor)} made by the platform` : ''}.`,
      to: 'st-stretch',
      score: 70,
    });
  }

  // ---- what to act on
  const missed = p.wants.searches.emptyTop[0];
  if (missed && missed.count >= 2) {
    out.push({
      key: 'searches',
      tone: 'act',
      icon: 'search',
      lead: `${missed.count} searches for “${missed.term}” found nothing`,
      rest: '— a kind of shop worth signing up next.',
      to: 'st-wants',
      score: 55 + Math.min(missed.count, 30),
    });
  }

  const { started, startedPaid } = p.bookings;
  if (started >= 5 && startedPaid / started < 0.6) {
    out.push({
      key: 'unpaid',
      tone: 'act',
      icon: 'wallet',
      lead: `${100 - pct(startedPaid, started)}% of bookings started were never paid for`,
      rest: `— ${started - startedPaid} of ${started} stopped at the payment step.`,
      to: 'st-stretch',
      score: 50 + (100 - pct(startedPaid, started)) / 4,
    });
  }

  const o = p.bookings.outcomes;
  const due = o.done + o.missed;
  if (due >= 5 && o.missed / due >= 0.2) {
    out.push({
      key: 'missed',
      tone: 'act',
      icon: 'userX',
      lead: `${pct(o.missed, due)}% of customers did not turn up`,
      rest: `for bookings that were due — ${o.missed} of ${due}.`,
      to: 'st-stretch',
      score: 45 + pct(o.missed, due) / 4,
    });
  }

  const top = p.shops.topByBookings[0];
  if (top && t.bookings >= 5 && p.shops.withBookings >= 2 && top.bookings / t.bookings >= 0.5) {
    out.push({
      key: 'one-shop',
      tone: 'act',
      icon: 'store',
      lead: `${top.name ?? 'One shop'} has ${pct(top.bookings, t.bookings)}% of all bookings`,
      rest: '— the platform leans on one shop for now.',
      to: 'st-people',
      score: 40 + pct(top.bookings, t.bookings) / 5,
    });
  }

  // ---- good to know
  const category = p.shops.byCategory[0];
  if (category && t.bookings >= 3 && category.bookings / t.bookings >= 0.4) {
    out.push({
      key: 'category',
      tone: 'info',
      icon: 'layers',
      lead: `${category.name} brings ${pct(category.bookings, t.bookings)}% of bookings`,
      rest: `— ${category.liveShops} live ${category.liveShops === 1 ? 'shop' : 'shops'} in it.`,
      to: 'st-people',
      score: 22,
    });
  }

  const c = p.customers;
  if (c.firstTime + c.returning >= 5 && c.returning > 0) {
    out.push({
      key: 'returning',
      tone: 'info',
      icon: 'refresh',
      lead: `${pct(c.returning, c.firstTime + c.returning)}% of customers who booked had booked before`,
      rest: '— they came back.',
      to: 'st-people',
      score: 20 + pct(c.returning, c.firstTime + c.returning) / 5,
    });
  }

  const l = p.bookings.leadTime;
  const ahead = l.sameDay + l.nextDay + l.withinWeek + l.later;
  if (ahead >= 5 && l.sameDay / ahead >= 0.4) {
    out.push({
      key: 'same-day',
      tone: 'info',
      icon: 'timer',
      lead: `${pct(l.sameDay, ahead)}% book for the same day`,
      rest: '— people decide late, so being open today matters.',
      to: 'st-stretch',
      score: 18,
    });
  }

  const when = busiest(p.bookings.heat);
  if (when) {
    out.push({ key: 'busiest', tone: 'info', icon: 'clock', lead: `Busiest: ${when}`, rest: '— when most booked visits take place.', to: 'st-stretch', score: 10 });
  }

  // The best three, with no more than two about growth.
  const picked: Insight[] = [];
  for (const insight of [...out].sort((a, b) => b.score - a.score)) {
    if (picked.length === 3) break;
    if (insight.growth && picked.filter((i) => i.growth).length === 2) continue;
    picked.push(insight);
  }
  return picked;
}
