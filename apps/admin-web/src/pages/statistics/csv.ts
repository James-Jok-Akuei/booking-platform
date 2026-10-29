import type { StatisticsMonths, StatisticsPeriod, StatisticsSummary } from '../../api/admin';
import { MEANING } from '../../lib/statsWords';

type Cell = string | number | null | undefined;

/** One cell, quoted when it must be, so a comma in a shop's name stays in its cell. */
const cell = (value: Cell) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Everything on the statistics page as one spreadsheet file (§316): the
 * all-time numbers, the stretch, month by month — each part under its own
 * heading, each number with what it counts. Money in whole units of the
 * platform's money, so a spreadsheet adds it up as it is.
 *
 * Shops are named here, as they are on the page: the file is for our team.
 * The pitch sheet is the one that never names a shop.
 */
export function statisticsCsv(input: {
  summary: StatisticsSummary;
  period: StatisticsPeriod;
  months: StatisticsMonths;
  exponent: number;
  /** What the page was narrowed to, said in words. */
  scopeWords: string;
}): string {
  const { summary, period, months, exponent, scopeWords } = input;
  const cur = summary.currency;
  const m = (minor: number | null | undefined) => (minor === null || minor === undefined ? '' : (minor / 10 ** exponent).toFixed(exponent));
  const rows: Cell[][] = [];
  const add = (...r: Cell[]) => rows.push(r);
  const gap = () => rows.push([]);

  add('Bwangu Reservations — statistics');
  add('Counted', new Date(summary.asOf).toLocaleString());
  add('Showing', scopeWords);
  add('Money', `${cur}, in whole units`);
  add('Test accounts', `${summary.leftOut.shops} shops and ${summary.leftOut.customers} customers left out`);
  gap();

  add('ALL TIME', 'Value', 'What it counts');
  add('Made by the platform', m(summary.madeMinor), MEANING.made);
  add('Bookings', summary.bookings, MEANING.bookings);
  add('Booking value', m(summary.bookingValueMinor), MEANING.bookingValue);
  add('Deposits paid through the app', m(summary.depositsMinor), MEANING.deposits);
  add('Customers', summary.customers, MEANING.customers);
  add('Customers who booked', summary.customersWhoBooked, MEANING.customersWhoBooked);
  add('Booked twice or more', summary.cameBack, MEANING.cameBack);
  add('Live shops', summary.liveShops, MEANING.liveShops);
  add('Open branches', summary.openBranches, '');
  add('Areas', summary.areas, MEANING.areas);
  add('Average rating', summary.rating.average ?? '', `${summary.rating.count} reviews. ${MEANING.rating}`);
  add('First booking', summary.since ?? '', '');
  gap();

  const t = period.totals;
  const p = period.previous;
  add(`${period.from} TO ${period.to}`, 'Value', p ? 'The same length before' : '', 'What it counts');
  add('Bookings', t.bookings, p?.bookings, MEANING.bookings);
  add('Booking value', m(t.bookingValueMinor), m(p?.bookingValueMinor), MEANING.bookingValue);
  add('Of it, already done', m(t.doneValueMinor), m(p?.doneValueMinor), MEANING.doneValue);
  add('Deposits', m(t.depositsMinor), m(p?.depositsMinor), MEANING.deposits);
  add('Platform fees kept', m(t.feesKeptMinor), m(p?.feesKeptMinor), MEANING.feesKept);
  add('Average booking', m(t.averageBookingMinor), m(p?.averageBookingMinor), MEANING.averageBooking);
  add('Average deposit', m(t.averageDepositMinor), m(p?.averageDepositMinor), MEANING.averageDeposit);
  add('New customers', t.newCustomers, p?.newCustomers, MEANING.newCustomers);
  add('Customers who booked', t.customersBooked, p?.customersBooked, MEANING.customersBooked);
  add('Shops that went live', t.shopsWentLive, p?.shopsWentLive, MEANING.shopsWentLive);
  gap();

  const o = period.bookings.outcomes;
  add('HOW BOOKINGS ENDED', 'Bookings');
  add('Done', o.done);
  add('Did not turn up', o.missed);
  add('Cancelled by the customer', o.cancelledByCustomer);
  add('Cancelled by the shop', o.cancelledByShop);
  add('Cancelled another way', o.cancelledOther);
  add('Still to come', o.upcoming);
  add('Started', period.bookings.started, '', MEANING.started);
  add('Of them paid', period.bookings.startedPaid);
  add('Refunds sent', period.bookings.refunds, m(period.bookings.refundsMinor), MEANING.refunds);
  add('Payouts sent', period.bookings.payouts, m(period.bookings.payoutsMinor), MEANING.payouts);
  gap();

  add(period.bucket === 'day' ? 'DAY' : period.bucket === 'week' ? 'WEEK FROM' : 'MONTH FROM', 'To', 'Bookings', 'Booking value', 'Deposits', 'Fees kept', 'New customers', 'Shops live');
  for (const bar of period.series) {
    add(bar.start, bar.end, bar.bookings, m(bar.bookingValueMinor), m(bar.depositsMinor), m(bar.feesKeptMinor), bar.newCustomers, bar.shopsWentLive);
  }
  gap();

  add('TOP SHOPS BY BOOKINGS', 'Category', 'Bookings', 'Booking value', 'Rating');
  for (const s of period.shops.topByBookings) add(s.name ?? 'No name yet', s.category, s.bookings, m(s.bookingValueMinor), s.rating ?? '');
  gap();
  add('BY CATEGORY', 'Bookings', 'Booking value', 'Live shops');
  for (const s of period.shops.byCategory) add(s.name, s.bookings, m(s.bookingValueMinor), s.liveShops);
  gap();
  add('BY DISTRICT', 'Bookings', 'Booking value', 'Live shops');
  for (const s of period.shops.byDistrict) add(s.name, s.bookings, m(s.bookingValueMinor), s.liveShops);
  gap();
  add('MOST BOOKED SERVICES', 'Bookings', 'Shops');
  for (const s of period.wants.topServices) add(s.name, s.bookings, s.shops);
  gap();
  add('SEARCHES', 'Times');
  for (const s of period.wants.searches.top) add(s.term, s.count);
  add('SEARCHED, FOUND NOTHING', 'Times');
  for (const s of period.wants.searches.emptyTop) add(s.term, s.count);
  gap();

  add('MONTH', 'Bookings', 'Booking value', 'Deposits', 'Fees kept', 'New customers', 'Shops live', 'Customers who booked');
  for (const r of months.months) {
    add(r.month, r.bookings, m(r.bookingValueMinor), m(r.depositsMinor), m(r.feesKeptMinor), r.newCustomers, r.shopsWentLive, r.activeCustomers);
  }
  gap();
  add('FIRST BOOKING IN', 'Customers', ...months.months.slice(1).map((_, i) => `${i + 1} month${i ? 's' : ''} later`));
  for (const c of months.cohorts) add(c.month, c.customers, ...c.back);

  // A byte-order mark first, so Excel reads the file's accents as they are.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Hands the reader a file, without a round trip to the server. */
export function download(fileName: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
