import { plural, t } from '@lingui/core/macro';
import type { TodayItem } from '../api/business';
import { dateLocale, formatDate } from '../i18n/format';
import type { AdData } from './useAdData';
import type { Slide } from './slides';

/**
 * "Rwanda today" in For you (§310): the facts the server finds for this shop
 * — mobile money slow, Umuganda or a holiday ahead, what customers near it
 * search for, rain, a tax date, the rates, our team's news — each said as a
 * card, in whole sentences, with the button that does something about it.
 * `urgent` cards go first; the rest find their places among the shop's own.
 */
export type TodaySlides = { urgent: Slide[]; day: Slide[]; later: Slide[] };

/** The public holidays by the server's names for them. */
const HOLIDAY: Record<string, string> = {
  get 'new-year'() { return t`New Year’s Day`; },
  get 'new-year-2'() { return t`The day after New Year`; },
  get heroes() { return t`Heroes’ Day`; },
  get memorial() { return t`Genocide against the Tutsi Memorial Day`; },
  get 'good-friday'() { return t`Good Friday`; },
  get 'easter-monday'() { return t`Easter Monday`; },
  get labour() { return t`Labour Day`; },
  get independence() { return t`Independence Day`; },
  get liberation() { return t`Liberation Day`; },
  get umuganura() { return t`Umuganura`; },
  get assumption() { return t`Assumption Day`; },
  get christmas() { return t`Christmas Day`; },
  get boxing() { return t`Boxing Day`; },
  get 'eid-al-fitr'() { return t`Eid al-Fitr`; },
  get 'eid-al-adha'() { return t`Eid al-Adha`; },
};

const dayWords = (date: string) => formatDate(`${date}T12:00:00`, { weekday: 'long', day: 'numeric', month: 'long' });
const francs = (n: number) =>
  // A no-break space: "RWF" and its number never part at the end of a line.
  `RWF\u00a0${new Intl.NumberFormat(dateLocale(), { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n)}`;

/** Beside the urgent ones, at most this many at a time: the shop's own cards stay the most of the banner. */
const AT_MOST = 2;

export function todaySlides(d: AdData): TodaySlides {
  const out: TodaySlides = { urgent: [], day: [], later: [] };
  let others = 0;
  // The server sends them most important first.
  for (const item of d.today?.items ?? []) {
    const urgent = item.kind === 'momo' || item.kind === 'kwibuka';
    if (!urgent && others >= AT_MOST) continue;
    const slide = slideFor(item, d);
    if (!slide) continue;
    if (urgent) out.urgent.push(slide);
    else {
      others += 1;
      out[item.kind === 'rates' ? 'later' : 'day'].push(slide);
    }
  }
  return out;
}

function slideFor(item: TodayItem, d: AdData): Slide | null {
  switch (item.kind) {
    case 'momo':
      return item.momo === 'down'
        ? {
            key: 'today-momo',
            look: 'amber',
            icon: 'alert',
            effect: 'ripples',
            eyebrow: t`Mobile money`,
            title: t`MTN MoMo is not answering`,
            text: t`Customers cannot pay deposits right now. Their times stay held while they try again.`,
            gist: t`Deposits cannot start right now — try again in a few minutes`,
          }
        : {
            key: 'today-momo',
            look: 'amber',
            icon: 'alert',
            effect: 'ripples',
            eyebrow: t`Mobile money`,
            title: t`MTN MoMo is slow right now`,
            text: t`Some deposits are slow or failing. Customers’ times stay held while they retry.`,
            gist: t`Deposits may take longer — customers can try again`,
          };

    case 'kwibuka':
      return {
        key: 'today-kwibuka',
        look: 'calm',
        icon: 'info',
        effect: 'none',
        eyebrow: t`Kwibuka ${item.number ?? ''}`,
        title: t`We remember`,
        text: t`Rwanda remembers the Genocide against the Tutsi. Bookings work as usual.`,
        gist: t`A week of remembrance — the app stays quiet`,
      };

    case 'umuganda': {
      const open = (item.branches ?? []).filter((b) => !b.covered);
      const date = item.date ?? '';
      const one = open.length === 1 ? open[0].name : null;
      return {
        key: 'today-umuganda',
        look: 'green',
        icon: 'calendarX',
        effect: 'waves',
        eyebrow: t`Umuganda · ${dayWords(date)}`,
        title: t`Saturday morning is Umuganda`,
        text: one
          ? t`Shops close 08:00–11:00, but ${one} is open for bookings then.`
          : plural(open.length, {
              one: 'Shops close 08:00–11:00, but # of your branches is open for bookings then.',
              other: 'Shops close 08:00–11:00, but # of your branches are open for bookings then.',
            }),
        gist: t`08:00–11:00 · block the morning`,
        cta: d.access.runsBranches
          ? { label: t`Block the morning`, to: `/closures?date=${date}&from=08:00&to=11:00&why=${encodeURIComponent('Umuganda')}` }
          : undefined,
      };
    }

    case 'holiday': {
      const name = HOLIDAY[item.holiday ?? ''] ?? '';
      const date = item.date ?? '';
      return {
        key: 'today-holiday',
        look: 'violet',
        icon: 'calendar',
        effect: 'stars',
        eyebrow: t`Public holiday · ${dayWords(date)}`,
        title: name,
        text: t`Will you open? Close the day or set its hours.`,
        gist: t`Open or closed? Set the day`,
        cta: d.access.runsBranches ? { label: t`Set the day`, to: `/closures?date=${date}&why=${encodeURIComponent(name)}` } : undefined,
      };
    }

    case 'searches': {
      const count = item.count ?? 0;
      const district = item.district ?? '';
      return {
        key: 'today-searches',
        look: 'blue',
        icon: 'search',
        effect: 'constellation',
        eyebrow: t`Customers near you`,
        title: `“${item.term ?? ''}”`,
        text: item.offered
          ? plural(count, {
              one: `# search this week in ${district}, and you offer it. A discount could bring them in.`,
              other: `# searches this week in ${district}, and you offer it. A discount could bring them in.`,
            })
          : plural(count, {
              one: `# search this week in ${district}, and you do not offer it yet.`,
              other: `# searches this week in ${district}, and you do not offer it yet.`,
            }),
        stat: { value: String(count), label: count === 1 ? t({ message: 'search', context: 'under a number' }) : t({ message: 'searches', context: 'under a number' }) },
        gist: plural(count, { one: '# search near you this week', other: '# searches near you this week' }),
        cta: d.access.runsBusiness ? { label: item.offered ? t`Give it a discount` : t`Add a service`, to: '/services' } : undefined,
      };
    }

    case 'rain':
      return {
        key: 'today-rain',
        look: 'blue',
        icon: 'alert',
        effect: 'meteors',
        eyebrow: t`Weather · ${item.district ?? ''}`,
        title: t`Heavy rain from ${item.from ?? ''}`,
        text: t`Customers may arrive late or change plans.`,
        gist: t`Expect late arrivals`,
        cta: { label: t`See today’s bookings`, to: '/appointments' },
      };

    case 'tax': {
      const date = dayWords(item.date ?? '');
      const RRA = 'https://www.rra.gov.rw';
      if (item.tax === 'licence') {
        return {
          key: 'today-tax',
          look: 'night',
          icon: 'legal',
          effect: 'aurora',
          eyebrow: t`Taxes · RRA`,
          title: t`The trading licence tax is due by ${date}`,
          text: t`Declared and paid through the Rwanda Revenue Authority (RRA).`,
          gist: t`Due by ${date}`,
          cta: { label: t`Open RRA`, href: RRA },
        };
      }
      if (item.tax === 'annual') {
        return {
          key: 'today-tax',
          look: 'night',
          icon: 'legal',
          effect: 'aurora',
          eyebrow: t`Taxes · RRA`,
          title: t`The annual income tax return is due by ${date}`,
          text: t`For last year’s income, filed with the Rwanda Revenue Authority (RRA).`,
          gist: t`Due by ${date}`,
          cta: { label: t`Open RRA`, href: RRA },
        };
      }
      return {
        key: 'today-tax',
        look: 'night',
        icon: 'legal',
        effect: 'aurora',
        eyebrow: t`Taxes · RRA`,
        title: t`VAT and PAYE are due by ${date}`,
        text: t`If you file monthly, last month’s return and payment go to RRA.`,
        gist: t`Due by ${date}`,
        cta: { label: t`Open RRA`, href: RRA },
      };
    }

    case 'rates': {
      const by = Object.fromEntries((item.rates ?? []).map((r) => [r.code, r]));
      if (!by.USD) return null;
      const usd = francs(by.USD.rwf);
      const eur = by.EUR ? francs(by.EUR.rwf) : '';
      const kes = by.KES ? francs(by.KES.rwf) : '';
      const ugx = by.UGX ? francs(by.UGX.rwf) : '';
      const source = item.source ?? '';
      return {
        key: 'today-rates',
        look: 'green',
        icon: 'coins',
        effect: 'coins',
        eyebrow: t`Market rates · ${dayWords(item.date ?? '')}`,
        title: t`1 US dollar = ${usd}`,
        // Short enough for three lines on a phone, the "not official" part included.
        text: t`€1 = ${eur} · KSh 1 = ${kes} · USh 1 = ${ugx}. Not the official BNR rates.`,
        gist: t`€1 = ${eur} · KSh 1 = ${kes}`,
        // The free feed asks to be named; the button does it.
        cta: item.sourceUrl ? { label: t`Rates by ${source}`, href: item.sourceUrl } : undefined,
      };
    }

    case 'news':
      return {
        key: `today-news-${item.newsId ?? ''}`,
        look: 'coral',
        icon: 'megaphone',
        effect: 'rays',
        eyebrow: t`From BwanguReservations`,
        title: item.title ?? '',
        text: item.body ?? '',
        gist: item.body ?? '',
        cta: item.linkPath && item.linkLabel ? { label: item.linkLabel, to: item.linkPath } : undefined,
      };

    default:
      return null;
  }
}
