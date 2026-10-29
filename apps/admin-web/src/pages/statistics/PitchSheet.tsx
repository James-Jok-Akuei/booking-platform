import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getStatisticsMonths, getStatisticsPeriod, getStatisticsSummary, type StatisticsScope } from '../../api/admin';
import { useMoney } from '../../money';
import { Icon } from '../../ui/Icon';
import { Logo, Wordmark } from '../../ui/Logo';
import { MEANING } from '../../lib/statsWords';
import { useCountries } from '../../lib/countries';
import { change, dayWords, monthWords, share, useScopeChoices } from './state';
import './pitch.css';

/**
 * The pitch sheet (§316): the platform's numbers on one page, to print or
 * save as a PDF and hand to an investor or a partner.
 *
 * Totals only — it never names a shop (the user's decision, 2026-10-29),
 * and test accounts are always left out, whatever the statistics page was
 * showing. Each figure carries the same meaning as on the page.
 */
export function PitchSheet() {
  const [params] = useSearchParams();
  const money = useMoney();
  const countries = useCountries();
  const choices = useScopeChoices();
  const scope: StatisticsScope = {
    country: params.get('country') ?? undefined,
    category: params.get('category') ?? undefined,
    district: params.get('district') ?? undefined,
  };
  const summary = useQuery({ queryKey: ['statistics', 'summary', scope], queryFn: () => getStatisticsSummary(scope) });
  const months = useQuery({ queryKey: ['statistics', 'months', scope], queryFn: () => getStatisticsMonths({ ...scope, months: 12 }) });
  const all = useQuery({ queryKey: ['statistics', 'period', scope, 'all'], queryFn: () => getStatisticsPeriod(scope) });

  const s = summary.data;
  const mo = months.data;
  const p = all.data;
  const ready = !!(s && mo && p);

  const where = [
    countries.find((c) => c.code === scope.country)?.name,
    choices.categories.find((c) => c.id === scope.category)?.name,
    choices.provinces.flatMap((pr) => pr.districts).find((d) => d.id === scope.district)?.name,
  ].filter(Boolean);

  const rows = mo?.months ?? [];
  const max = Math.max(1, ...rows.map((r) => r.bookings));
  const last = rows[rows.length - 1];
  const before = rows[rows.length - 2];
  const growth = last && before ? change(last.bookings, before.bookings) : null;
  const categories = (p?.shops.byCategory ?? []).filter((c) => c.bookings > 0).slice(0, 6);
  const categoryTotal = categories.reduce((sum, c) => sum + c.bookings, 0) || 1;
  const asOf = s ? new Date(s.asOf) : new Date();

  return (
    <div className="ps">
      <div className="ps-bar">
        <Link to="/statistics" className="ps-back">
          <Icon name="chevronLeft" size={17} />
          Statistics
        </Link>
        <span className="ps-note">Totals only — no shop is named, and test accounts are left out.</span>
        <button type="button" className="ps-print" disabled={!ready} onClick={() => window.print()}>
          <Icon name="download" size={17} />
          Print or save as PDF
        </button>
      </div>

      <article className="ps-sheet" aria-busy={!ready}>
        <header className="ps-head">
          <div className="ps-brand">
            <Logo size={46} />
            <Wordmark />
          </div>
          <div className="ps-when">
            <strong>In numbers</strong>
            <span>
              {asOf.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
              {where.length ? ` · ${where.join(' · ')}` : ''}
            </span>
          </div>
        </header>

        {!ready ? (
          <div className="ps-wait">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        ) : (
          <>
            <section className="ps-hero">
              <div className="ps-made">
                <span>Made by the platform</span>
                <strong>{money.format(s.madeMinor)}</strong>
                <em>{s.since ? `In platform fees since ${dayWords(s.since, true)}` : 'From the first booking'}</em>
              </div>
              <div className="ps-pair">
                <div>
                  <span>Booking value</span>
                  <strong>{money.format(s.bookingValueMinor)}</strong>
                  <em>The full price of every booking not cancelled</em>
                </div>
                <div>
                  <span>Bookings</span>
                  <strong>{s.bookings.toLocaleString()}</strong>
                  <em>Paid for through the app</em>
                </div>
              </div>
            </section>

            <section className="ps-grid">
              <Fig label="Customers who booked" value={s.customersWhoBooked.toLocaleString()} sub={`${s.customers.toLocaleString()} customer accounts`} />
              <Fig label="Booked again" value={share(s.cameBack, s.customersWhoBooked)} sub="of customers who booked" />
              <Fig label="Live shops" value={s.liveShops.toLocaleString()} sub={`${s.openBranches} branches`} />
              <Fig label="Areas" value={s.areas.toLocaleString()} sub={`${s.categories} ${s.categories === 1 ? 'category' : 'categories'}`} />
              <Fig label="Average rating" value={s.rating.average === null ? '—' : `${s.rating.average.toFixed(1)} ★`} sub={`${s.rating.count} reviews`} />
              <Fig label="Deposits taken" value={money.format(s.depositsMinor)} sub="through the app" />
            </section>

            <section className="ps-row">
              <div className="ps-chart">
                <h2>
                  Bookings, month by month
                  {growth && growth.tone !== 'flat' && before && (
                    <span className={`ps-growth is-${growth.tone}`}>
                      {growth.words} on {monthWords(before.month)}
                    </span>
                  )}
                </h2>
                <div className="ps-bars">
                  {rows.map((r) => (
                    <div key={r.month} className="ps-col">
                      <b>{r.bookings}</b>
                      <i style={{ height: `${r.bookings ? Math.max(4, (r.bookings / max) * 100) : 0}%` }} />
                      <span>{monthWords(r.month).replace(/\s\d{4}$/, '')}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="ps-cats">
                <h2>Where people book</h2>
                {categories.length === 0 ? (
                  <p className="ps-none">No bookings yet.</p>
                ) : (
                  <ul>
                    {categories.map((c) => (
                      <li key={c.id ?? 'none'}>
                        <span>{c.name}</span>
                        <i>
                          <b style={{ width: `${(c.bookings / categoryTotal) * 100}%` }} />
                        </i>
                        <strong>{Math.round((c.bookings / categoryTotal) * 100)}%</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <footer className="ps-foot">
              <p>
                <strong>How these are counted.</strong> {MEANING.made} {MEANING.bookingValue} {MEANING.bookings} Our own test accounts are left out.
              </p>
              <p>
                Counted from the platform’s records on {asOf.toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.
              </p>
            </footer>
          </>
        )}
      </article>
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="ps-fig">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{sub}</em>
    </div>
  );
}
