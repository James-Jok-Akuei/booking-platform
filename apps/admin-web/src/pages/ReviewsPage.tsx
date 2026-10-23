import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { hideReview, listReviewsForModeration, unhideReview, type ModeratedReview, type ReviewOrder } from '../api/admin';
import { ago } from '../lib/time';
import { Avatar } from '../ui/Avatar';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { ShopMark } from '../ui/ShopMark';
import { Stars } from '../ui/Stars';
import './reviews.css';
import { EmptyState } from '../ui/EmptyState';

const PAGE = 20;

type Show = 'VISIBLE' | 'HIDDEN' | 'ALL';
type StarFilter = 1 | 2 | 3 | 4 | 5 | 'low' | null;

const SHOWS: Array<{ value: Show; label: string }> = [
  { value: 'VISIBLE', label: 'Showing' },
  { value: 'HIDDEN', label: 'Hidden' },
  { value: 'ALL', label: 'All' },
];

const SORTS: Array<{ value: ReviewOrder; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'lowest', label: 'Lowest rating first' },
  { value: 'highest', label: 'Highest rating first' },
  { value: 'oldest', label: 'Oldest first' },
];

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const parseStars = (raw: string | null): StarFilter =>
  raw === 'low' ? 'low' : raw && /^[1-5]$/.test(raw) ? (Number(raw) as StarFilter) : null;

/**
 * Reviews, from the moderator's side (§248, §93).
 *
 * The business app's Reviews (§199, §215) — a score, the split by star, one
 * card of reviews with search and filters — turned around: each review is
 * someone writing about a shop, so it leads with who wrote it and names the
 * shop, and its one decision is whether customers may read it. This is the
 * only screen that can see a hidden review; every other listing leaves them
 * out in the query, which is what makes hiding real.
 */
export function ReviewsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const show = (params.get('show')?.toUpperCase() as Show | undefined) ?? 'VISIBLE';
  const stars = parseStars(params.get('stars'));
  const sort = (params.get('sort') as ReviewOrder | null) ?? 'newest';
  const q = params.get('q') ?? '';
  const [typed, setTyped] = useState(q);

  const patch = (next: Record<string, string | null>) =>
    setParams(
      (now) => {
        const out = new URLSearchParams(now);
        for (const [k, v] of Object.entries(next)) {
          if (v === null || v === '') out.delete(k);
          else out.set(k, v);
        }
        return out;
      },
      { replace: true },
    );

  useEffect(() => {
    const t = setTimeout(() => {
      if (typed.trim() !== q) patch({ q: typed.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const list = useInfiniteQuery({
    queryKey: ['moderated-reviews', show, stars, sort, q],
    queryFn: ({ pageParam }) =>
      listReviewsForModeration({
        visibility: show,
        sort,
        ...(q ? { q } : {}),
        ...(stars === 'low' ? { maxRating: 2 } : stars ? { rating: stars } : {}),
        limit: PAGE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, p) => sum + p.reviews.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: (previous) => previous,
  });

  const first = list.data?.pages[0];
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.reviews) ?? [], [list.data]);
  const breakdown = first?.breakdown;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['moderated-reviews'] });

  // The next page loads as the end of the list comes into view.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, [list]);

  const pickStars = (next: StarFilter) => patch({ stars: next === null || next === stars ? null : String(next) });

  const hide = useMutation({ mutationFn: (input: { id: string; reason: string }) => hideReview(input.id, input.reason), onSuccess: refresh });
  const unhide = useMutation({ mutationFn: unhideReview, onSuccess: refresh });

  const onHide = async (review: ModeratedReview) => {
    const reason = await promptDialog({
      title: `Hide this ${review.rating}-star review?`,
      body: (
        <p>
          About <strong>{review.businessName ?? 'this shop'}</strong>, by {review.displayName}. Customers stop seeing it and it stops
          counting towards the shop's stars. The words are kept — they are usually the evidence in whatever led here.
        </p>
      ),
      label: 'Why are you hiding it?',
      placeholder: 'For example: names a member of staff and insults them.',
      note: 'Kept with the review, against your name. The customer is told why; the shop is told its rating changed.',
      minLength: 3,
      minMessage: 'A reason of at least 3 characters.',
      multiline: true,
      tone: 'warn',
      icon: 'eyeOff',
      confirmLabel: 'Hide the review',
      cancelLabel: 'Keep it showing',
    });
    if (reason !== null) hide.mutate({ id: review.id, reason: reason.trim() });
  };

  const onUnhide = async (review: ModeratedReview) => {
    const ok = await confirmDialog({
      title: 'Show this review again?',
      body: (
        <p>
          Customers can read it again, and its {review.rating} {review.rating === 1 ? 'star counts' : 'stars count'} towards{' '}
          <strong>{review.businessName ?? 'the shop'}</strong>'s rating again. It was hidden because: “{review.hiddenReason}”
        </p>
      ),
      tone: 'info',
      icon: 'eye',
      confirmLabel: 'Show it again',
      cancelLabel: 'Keep it hidden',
    });
    if (ok) unhide.mutate(review.id);
  };

  const error = hide.error ?? unhide.error;

  return (
    <section className="rv">
      <div className="page-top rv-top">
        <header className="page-head">
          <div>
            <h1>Reviews</h1>
            <p className="muted">What customers wrote about shops, and what has been taken down.</p>
          </div>
        </header>

        <Summary
          loading={!first}
          stars={breakdown?.stars ?? [0, 0, 0, 0, 0]}
          ratingAvg={breakdown?.ratingAvg ?? null}
          visible={breakdown?.visible ?? 0}
          hidden={breakdown?.hidden ?? 0}
          picked={stars}
          onPick={pickStars}
          onHidden={() => patch({ show: 'hidden', stars: null })}
        />

        <div className="rv-card-top pin-from">
          <div className="rv-toolbar">
            <label className="rv-search">
              <Icon name="search" size={17} />
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Search the words, a reviewer or a shop"
                aria-label="Search reviews"
              />
              {typed && (
                <button type="button" className="rv-search-clear" onClick={() => setTyped('')} aria-label="Clear">
                  <Icon name="close" size={13} stroke={2.2} />
                </button>
              )}
            </label>
            <div className="rv-sort">
              <Icon name="sliders" size={15} />
              <Select variant="bare" value={sort} onChange={(v) => patch({ sort: v === 'newest' ? null : v })} label="Order" options={SORTS} />
            </div>
          </div>
          <div className="rv-tabs pin-phone" role="tablist">
            {SHOWS.map((s) => {
              const count = s.value === 'VISIBLE' ? breakdown?.visible : s.value === 'HIDDEN' ? breakdown?.hidden : breakdown && breakdown.visible + breakdown.hidden;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="tab"
                  aria-selected={show === s.value}
                  className={`rv-tab${show === s.value ? ' is-on' : ''}${s.value === 'HIDDEN' ? ' tone-warn' : ''}`}
                  onClick={() => patch({ show: s.value === 'VISIBLE' ? null : s.value.toLowerCase() })}
                >
                  {s.label}
                  {count !== undefined && <span className="rv-tab-count">{count.toLocaleString()}</span>}
                </button>
              );
            })}
            <span className="rv-tabs-gap" aria-hidden="true" />
            <button
              type="button"
              className={`rv-chip${stars === 'low' ? ' is-on' : ''}`}
              aria-pressed={stars === 'low'}
              onClick={() => pickStars('low')}
              title="The ones that get disputed"
            >
              1–2 <Icon name="star" size={12} filled /> only
            </button>
            {typeof stars === 'number' && (
              <button type="button" className="rv-chip is-on" onClick={() => pickStars(null)} aria-label={`Showing ${stars}-star reviews only; show every rating`}>
                {stars} <Icon name="star" size={12} filled /> only <Icon name="close" size={12} stroke={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`rv-board${list.isPlaceholderData ? ' is-refreshing' : ''}`}>
        {error && (
          <p className="error rv-error" role="alert">
            <Icon name="alert" size={15} />
            {error instanceof ApiError ? error.message : 'That did not work.'}
          </p>
        )}

        {list.isLoading && (
          <div className="rv-skeletons" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rv-skel">
                <i />
                <div>
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </div>
        )}

        {first && rows.length === 0 && (
          <EmptyState
            size="card"
            className="is-list"
            art={q ? 'search' : show === 'HIDDEN' ? 'clear' : 'reviews'}
            title={q ? `Nothing matches “${q}”` : show === 'HIDDEN' ? 'Nothing is hidden' : 'No reviews here'}
            text={
              q
                ? 'Try other words, or another filter.'
                : show === 'HIDDEN'
                  ? 'Every review customers wrote can be read.'
                  : 'Customers can review a booking once the shop marks it done.'
            }
          />
        )}

        <ul className="rv-list">
          {rows.map((review, i) => (
            <ReviewRow
              key={review.id}
              review={review}
              index={i}
              find={q}
              busy={hide.isPending || unhide.isPending}
              onHide={() => void onHide(review)}
              onUnhide={() => void onUnhide(review)}
            />
          ))}
        </ul>

        <div ref={end} />
        {rows.length > 0 && first && (
          <footer className="rv-foot">
            <span>
              Showing <strong>{rows.length.toLocaleString()}</strong> of <strong>{first.total.toLocaleString()}</strong>
            </span>
            {list.hasNextPage && (
              <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            )}
          </footer>
        )}
      </div>
    </section>
  );
}

/** The platform's rating, how it splits by star (each a filter), and what has been taken down. */
function Summary({
  loading,
  stars,
  ratingAvg,
  visible,
  hidden,
  picked,
  onPick,
  onHidden,
}: {
  loading: boolean;
  stars: number[];
  ratingAvg: number | null;
  visible: number;
  hidden: number;
  picked: StarFilter;
  onPick: (s: StarFilter) => void;
  onHidden: () => void;
}) {
  const most = Math.max(1, ...stars);
  const all = visible + hidden;
  const share = all ? hidden / all : 0;
  const c = 2 * Math.PI * 20;
  return (
    <div className={`rv-summary${loading ? ' is-loading' : ''}`}>
      <div className="rv-score">
        <strong>{ratingAvg === null ? '–' : ratingAvg.toFixed(1)}</strong>
        <Stars value={ratingAvg ?? 0} size={18} />
        <span>
          {visible === 0 ? 'No reviews showing yet' : `across ${visible.toLocaleString()} ${visible === 1 ? 'review' : 'reviews'} customers can read`}
        </span>
      </div>

      <div className="rv-bars">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = stars[n - 1];
          return (
            <button
              key={n}
              type="button"
              className={`rv-bar${picked === n ? ' is-on' : ''}${n <= 2 ? ' is-low' : ''}`}
              onClick={() => onPick(n as StarFilter)}
              title={`Show ${n}-star reviews`}
            >
              <span className="rv-bar-label">
                {n} <Icon name="star" size={12} filled />
              </span>
              <span className="rv-bar-track">
                <i style={{ width: `${(count / most) * 100}%` }} />
              </span>
              <span className="rv-bar-count">{count.toLocaleString()}</span>
              <span className="rv-bar-pct">{visible ? Math.round((count / visible) * 100) : 0}%</span>
            </button>
          );
        })}
      </div>

      <div className="rv-reply-card rv-hidden-card">
        <span className="rv-reply-ring" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="58" height="58">
            <circle cx="24" cy="24" r="20" className="t" />
            <circle cx="24" cy="24" r="20" className="f" strokeDasharray={c} strokeDashoffset={c * (1 - share)} />
          </svg>
          <b>{hidden.toLocaleString()}</b>
        </span>
        <div>
          <strong>{hidden === 0 ? 'Nothing hidden' : `${hidden.toLocaleString()} hidden from customers`}</strong>
          <span>
            {hidden === 0
              ? 'Every review is up. A hidden one leaves the shop’s stars, and its words are kept.'
              : `${Math.max(1, Math.round(share * 100))}% of all reviews. They leave the shop’s stars; their words are kept as evidence.`}
          </span>
          {hidden > 0 && (
            <button type="button" onClick={onHidden}>
              See them <Icon name="arrowRight" size={14} stroke={2.2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The search words, marked where they appear. */
function Marked({ text, find }: { text: string; find: string }) {
  if (!find) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = find.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1 && parts.length < 40; i = lower.indexOf(needle, at)) {
    parts.push(text.slice(at, i), <mark key={i}>{text.slice(i, i + find.length)}</mark>);
    at = i + find.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function ReviewRow({
  review,
  index,
  find,
  busy,
  onHide,
  onUnhide,
}: {
  review: ModeratedReview;
  index: number;
  find: string;
  busy: boolean;
  onHide: () => void;
  onUnhide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const long = (review.comment?.length ?? 0) > 260;
  const tone = review.rating >= 4 ? 'good' : review.rating === 3 ? 'mid' : 'low';
  const hidden = Boolean(review.hiddenAt);
  const named = review.displayName !== 'Anonymous';

  return (
    <li className={`rv-row tone-${tone}${hidden ? ' is-hidden' : ''}`} style={{ animationDelay: `${Math.min(index % PAGE, 8) * 30}ms` }}>
      <Avatar label={named ? review.displayName : review.customerEmail} size={42} />
      <div className="rv-main">
        <div className="rv-head">
          <div className="rv-who">
            <strong>
              <Marked text={review.displayName} find={find} />
              <em>
                <Marked text={review.customerEmail} find={find} />
              </em>
            </strong>
            <span className="rv-about">
              <ShopMark name={review.businessName} logoUrl={review.businessLogoUrl} size={20} />
              <b>
                <Marked text={review.businessName ?? 'Unnamed shop'} find={find} />
              </b>
              <span>
                · <Marked text={review.locationName} find={find} />
              </span>
            </span>
            <span>
              {review.serviceName && (
                <>
                  <Icon name="tag" size={12} /> {review.serviceName} ·{' '}
                </>
              )}
              {when(review.createdAt)}
              {review.editedAt && ' · edited'}
            </span>
          </div>
          <span className={`rv-stars tone-${tone}`} title={`${review.rating} out of 5`}>
            <Stars value={review.rating} size={14} />
            <b>{review.rating}.0</b>
          </span>
        </div>

        {review.comment ? (
          <p className={`rv-text${long && !open ? ' is-clamped' : ''}`}>
            <Marked text={review.comment} find={find} />
          </p>
        ) : (
          <p className="rv-text is-empty">A rating, no words.</p>
        )}
        {long && (
          <button type="button" className="rv-more" onClick={() => setOpen((v) => !v)}>
            {open ? 'Show less' : 'Read all'}
          </button>
        )}

        {review.responseText && (
          <div className="rv-reply">
            <ShopMark name={review.businessName} logoUrl={review.businessLogoUrl} size={30} className="rv-reply-mark" />
            <div className="rv-reply-body">
              <div className="rv-reply-meta">
                <strong>The shop replied</strong>
                <span>
                  {review.responseAt && ago(review.responseAt)}
                  {review.responseEditedAt && ' · edited'}
                </span>
              </div>
              <p>{review.responseText}</p>
            </div>
          </div>
        )}

        {hidden && (
          <div className="rv-hidden-note">
            <Icon name="eyeOff" size={16} />
            <span>
              <strong>Hidden from customers</strong> {review.hiddenAt && when(review.hiddenAt)}
              {review.hiddenByEmail && <> by {review.hiddenByEmail}</>}
              <em>“{review.hiddenReason}”</em>
            </span>
          </div>
        )}

        <div className="rv-actions">
          {hidden ? (
            <button type="button" className="rv-act is-restore" disabled={busy} onClick={onUnhide}>
              <Icon name="eye" size={15} /> Show it again
            </button>
          ) : (
            <button type="button" className="rv-act" disabled={busy} onClick={onHide}>
              <Icon name="eyeOff" size={15} /> Hide from customers
            </button>
          )}
          <Link className="rv-link" to={`/appointments?open=${review.appointmentId}`}>
            The booking <Icon name="arrowRight" size={13} stroke={2.2} />
          </Link>
        </div>
      </div>
    </li>
  );
}
