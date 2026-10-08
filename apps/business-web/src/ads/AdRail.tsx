import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { DiscoveredService } from '../api/discovery';
import { useMoney } from '../money';
import { Icon } from '../ui/Icon';
import { AdCarousel } from './AdCarousel';
import { buildSlides } from './slides';
import { tipFor } from './tips';
import { useAdData, type AdData } from './useAdData';
import './ads.css';

/**
 * "For you" — the column down the right of every page on a wide screen (§204).
 *
 * The banner of adverts at the top; under it what the shop is missing, what
 * customers are booking elsewhere, and a tip about the page you are on. It
 * folds to a slim strip (remembered), which hands the room back to the page.
 * Nothing in it is paid for: every advert is made from the shop's own data,
 * the public list of popular services, or the platform itself.
 */
export function AdRail({ folded, onFold }: { folded: boolean; onFold: () => void }) {
  const data = useAdData();
  const { pathname } = useLocation();

  if (folded) {
    return (
      <aside className="ads is-folded">
        <button type="button" className="ads-unfold" onClick={onFold} aria-label="Open For you" title="Open For you">
          <span className="ads-unfold-icon">
            <Icon name="sparkles" size={20} />
            {data.missing.length > 0 && <i>{data.missing.length}</i>}
          </span>
          <span className="ads-unfold-label">For you</span>
        </button>
      </aside>
    );
  }

  const slides = buildSlides(data);
  const tip = tipFor(pathname);

  return (
    <aside className="ads" aria-label="For you">
      <header className="ads-head">
        <div>
          <h2>
            <Icon name="sparkles" size={17} /> For you
          </h2>
          <p>Ideas, news and tips for your shop</p>
        </div>
        <button type="button" className="ads-fold" onClick={onFold} aria-label="Fold For you" title="Fold">
          <Icon name="chevronRight" size={18} />
        </button>
      </header>

      <div className="ads-scroll">
        {data.ready ? <AdCarousel slides={slides} /> : <div className="skeleton ads-skel" />}

        {data.ready && data.checks.length > 0 && <HealthCard data={data} />}

        <Trending data={data} />

        <article className="ads-tip" key={pathname}>
          <span className="ads-tip-icon">
            <Icon name={tip.icon} size={18} />
          </span>
          <div>
            <p className="ads-label">Did you know?</p>
            <strong>{tip.title}</strong>
            <span>{tip.text}</span>
          </div>
        </article>

        <p className="ads-foot">
          <Icon name="info" size={13} /> Chosen from your shop and the app. Nothing here is paid for.
        </p>
      </div>
    </aside>
  );
}

/** "Make your shop stand out": a score and the first few things missing. */
function HealthCard({ data }: { data: AdData }) {
  const [all, setAll] = useState(false);
  const r = 26;
  const c = 2 * Math.PI * r;
  const missing = data.missing;
  const shown = all ? missing : missing.slice(0, 4);
  const complete = missing.length === 0;

  return (
    <article className={`ads-health${complete ? ' is-complete' : ''}`}>
      <div className="ads-health-top">
        <span className="ads-ring" aria-label={`${data.score}% complete`}>
          <svg viewBox="0 0 64 64" width="64" height="64">
            <circle cx="32" cy="32" r={r} className="t" />
            <circle cx="32" cy="32" r={r} className="f" strokeDasharray={c} strokeDashoffset={c * (1 - data.score / 100)} />
          </svg>
          <b>{data.score}%</b>
        </span>
        <div>
          <p className="ads-label">Your shop</p>
          <strong>{complete ? 'Everything is in place' : 'Make it stand out'}</strong>
          <span>
            {complete
              ? 'Photos, words, hours and payouts — all set.'
              : `${missing.length} ${missing.length === 1 ? 'thing' : 'things'} customers notice`}
          </span>
        </div>
      </div>
      {!complete && (
        <ul className="ads-missing">
          {shown.map((check) => (
            <li key={check.key}>
              <Link to={check.to}>
                <span className="ads-missing-icon">
                  <Icon name={check.icon} size={15} />
                </span>
                <span className="ads-missing-text">
                  <strong>{check.label}</strong>
                  <em>{check.why}</em>
                </span>
                <Icon name="chevronRight" size={16} className="ads-go" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {missing.length > 4 && (
        <button type="button" className="ads-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${missing.length}`}
        </button>
      )}
    </article>
  );
}

/** What customers are booking — in the seller's own kind of business, then everywhere. */
function Trending({ data }: { data: AdData }) {
  const money = useMoney();
  const hasSame = data.trendingSame.length > 0;
  const [tab, setTab] = useState<'same' | 'all'>('same');
  const list = tab === 'same' && hasSame ? data.trendingSame : data.trendingEverywhere;
  if (!hasSame && data.trendingEverywhere.length === 0) return null;

  return (
    <article className="ads-trend" id="ads-trending">
      <header>
        <div>
          <p className="ads-label">Trending on the app</p>
          <strong>What customers are booking</strong>
        </div>
      </header>
      {hasSame && (
        <div className="ads-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'same'} className={tab === 'same' ? 'is-on' : ''} onClick={() => setTab('same')}>
            {data.subcategoryName ?? 'Your kind'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'is-on' : ''} onClick={() => setTab('all')}>
            Everywhere
          </button>
        </div>
      )}
      <ol className="ads-trend-list">
        {list.map((s, i) => (
          <TrendRow key={`${s.id}:${s.location.id}`} rank={i + 1} service={s} format={money.format} />
        ))}
      </ol>
      <p className="ads-trend-why">
        Ranked the way the customer app ranks them: bookings, weighted by rating. Compare yours on{' '}
        <Link to="/services">Services</Link>.
      </p>
    </article>
  );
}

function TrendRow({
  rank,
  service: s,
  format,
}: {
  rank: number;
  service: DiscoveredService;
  format: (minor: number | null | undefined, code?: string | null) => string;
}) {
  const rating = s.location.ratingCount > 0 ? Number(s.location.ratingAvg) : null;
  return (
    <li className="ads-trend-row">
      <span className="ads-rank">{rank}</span>
      <span className="ads-thumb" style={s.imageUrl ? { backgroundImage: `url(${s.imageUrl})` } : undefined}>
        {!s.imageUrl && <Icon name="image" size={16} />}
        {s.discount && <em>−{s.discount.percent}%</em>}
      </span>
      <span className="ads-trend-text">
        <strong>{s.name}</strong>
        <span>{s.business.name ?? s.location.name}</span>
        <span className="ads-trend-meta">
          <b>{format(s.priceMinor, s.currency)}</b>
          {rating !== null && (
            <>
              <i>·</i>
              <Icon name="star" size={11} filled />
              {rating.toFixed(1)}
            </>
          )}
          <i>·</i>
          {s.bookingCount} booked
        </span>
      </span>
    </li>
  );
}
