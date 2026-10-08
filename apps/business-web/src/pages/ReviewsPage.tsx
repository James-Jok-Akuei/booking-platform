import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  getProfile,
  listLocationReviews,
  listLocations,
  respondToReview,
  updateReviewResponse,
  REVIEW_EDIT_WINDOW_DAYS,
  type Review,
} from '../api/business';
import { ago } from '../lib/time';
import { Avatar, initialsOf } from '../ui/Avatar';
import { BranchPills } from '../ui/BranchPills';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { Stars } from '../ui/Stars';
import './reviews.css';

const PAGE = 20;

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** The reply is editable for a week after posting; the server enforces it. */
const withinEditWindow = (responseAt: string) =>
  (Date.now() - new Date(responseAt).getTime()) / 86_400_000 < REVIEW_EDIT_WINDOW_DAYS;

type Filter = 'all' | 'waiting' | 'replied' | 1 | 2 | 3 | 4 | 5;
type Sort = 'newest' | 'oldest' | 'lowest' | 'highest';

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'lowest', label: 'Lowest rating first' },
  { value: 'highest', label: 'Highest rating first' },
];

/** A value that settles a moment after typing stops. */
function useSettled<T>(value: T, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * What customers said, and the one reply each gets (§92, §199, §215).
 *
 * Built for a branch with a thousand reviews as much as one with four: the
 * server filters (a star, waiting for a reply, replied), searches (the words
 * or the reviewer's name), orders and pages them, and counts every review by
 * star and by reply beside whatever page is shown. The page reads twenty at a
 * time and fetches the next as the list nears its end.
 *
 * Replying is day-to-day work rather than configuration, so any active member
 * can do it. Hidden reviews are absent for everyone, the business included, so
 * this page shows exactly what a customer sees.
 */
export function ReviewsPage() {
  const queryClient = useQueryClient();
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [search, setSearch] = useState('');
  const q = useSettled(search.trim());

  const branches = (locations.data ?? []).filter((l) => l.isActive);
  const locationId = selected ?? branches[0]?.id ?? null;

  const options = {
    sort,
    ...(q ? { q } : {}),
    ...(typeof filter === 'number' ? { rating: filter } : {}),
    ...(filter === 'waiting' ? { replied: false } : filter === 'replied' ? { replied: true } : {}),
  };
  const list = useInfiniteQuery({
    queryKey: ['reviews', locationId, filter, sort, q],
    queryFn: ({ pageParam }) => listLocationReviews(locationId!, PAGE, { ...options, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, p) => sum + p.reviews.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    enabled: Boolean(locationId),
    placeholderData: (previous) => previous,
  });

  const first = list.data?.pages[0];
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.reviews) ?? [], [list.data]);
  const breakdown = first?.breakdown;
  const count = breakdown ? breakdown.stars.reduce((sum, n) => sum + n, 0) : 0;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['reviews', locationId] });
    queryClient.invalidateQueries({ queryKey: ['ads-reviews'] });
  };

  // The next page loads as the end of the list comes into view.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, [list]);

  const pick = (next: Filter) => setFilter((was) => (was === next && next !== 'all' ? 'all' : next));

  const tabs: Array<{ key: Filter; label: ReactNode; count: number | undefined; tone?: string }> = [
    { key: 'all', label: 'All', count },
    { key: 'waiting', label: 'Waiting for a reply', count: breakdown?.waiting, tone: 'accent' },
    { key: 'replied', label: 'Replied', count: breakdown?.replied },
    ...[5, 4, 3, 2, 1].map((n) => ({
      key: n as Filter,
      label: (
        <>
          {n} <Icon name="star" size={12} filled />
        </>
      ),
      count: breakdown?.stars[n - 1],
    })),
  ];

  return (
    <section className="rv">
      <div className="page-top rv-top">
        <header className="page-head">
          <div>
            <h1>Reviews</h1>
            <p className="muted">What customers said, and your reply. Everyone can see both.</p>
          </div>
        </header>

        <BranchPills
          branches={branches}
          value={locationId}
          onChange={(id) => {
            setSelected(id);
            setFilter('all');
          }}
          extra={(b) => (b.ratingCount > 0 ? `★ ${b.ratingAvg}` : null)}
        />

        {locationId && (
          <Summary
            loading={!first}
            ratingAvg={first?.ratingAvg ?? null}
            ratingCount={first?.ratingCount ?? 0}
            stars={breakdown?.stars ?? [0, 0, 0, 0, 0]}
            waiting={breakdown?.waiting ?? 0}
            replied={breakdown?.replied ?? 0}
            filter={filter}
            onFilter={pick}
          />
        )}

        {locationId && (
          <div className="rv-card-top pin-from">
            <div className="rv-toolbar">
              <label className="rv-search">
                <Icon name="search" size={17} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search the words or a name"
                  aria-label="Search reviews"
                />
                {search && (
                  <button type="button" className="rv-search-clear" onClick={() => setSearch('')} aria-label="Clear">
                    <Icon name="close" size={13} stroke={2.2} />
                  </button>
                )}
              </label>
              <div className="rv-sort">
                <Icon name="sliders" size={15} />
                <Select variant="bare" value={sort} onChange={setSort} label="Order" options={SORTS} />
              </div>
            </div>
            <div className="rv-tabs pin-phone" role="tablist">
              {tabs.map((t) => (
                <button
                  key={String(t.key)}
                  type="button"
                  role="tab"
                  aria-selected={filter === t.key}
                  className={`rv-tab${filter === t.key ? ' is-on' : ''}${t.tone ? ` tone-${t.tone}` : ''}${typeof t.key === 'number' ? ' is-star' : ''}`}
                  onClick={() => setFilter(t.key)}
                >
                  {t.label}
                  {t.count !== undefined && <span className="rv-tab-count">{t.count.toLocaleString()}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {locations.isLoading && <div className="skeleton rv-skeleton" />}
      {branches.length === 0 && !locations.isLoading && (
        <p className="muted">Add a branch first, under Branches &amp; hours.</p>
      )}

      {locationId && (
        <div className={`rv-board${list.isPlaceholderData ? ' is-refreshing' : ''}`}>
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

          {first && count === 0 && (
            <div className="rv-empty">
              <span>
                <Icon name="star" size={28} />
              </span>
              <strong>No reviews for this branch yet</strong>
              <p>Customers can review a booking once you mark it done.</p>
            </div>
          )}
          {first && count > 0 && rows.length === 0 && (
            <div className="rv-empty">
              <span>
                <Icon name={filter === 'waiting' ? 'checkCircle' : 'search'} size={28} />
              </span>
              <strong>{filter === 'waiting' && !q ? 'Every review has a reply' : 'Nothing matches'}</strong>
              <p>{filter === 'waiting' && !q ? 'Nice work — nothing is waiting for you.' : 'Try other words, or another filter.'}</p>
            </div>
          )}

          <ul className="rv-list">
            {rows.map((review, i) => (
              <ReviewRow key={review.id} review={review} index={i} find={q} onSaved={refresh} />
            ))}
          </ul>

          <div ref={end} />
          {rows.length > 0 && first && (
            <footer className="rv-foot">
              <span>
                Showing <strong>{rows.length.toLocaleString()}</strong> of <strong>{first.total.toLocaleString()}</strong>
                {first.total !== count ? ` (${count.toLocaleString()} in all)` : ''}
              </span>
              {list.hasNextPage && (
                <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
                </button>
              )}
            </footer>
          )}
        </div>
      )}
    </section>
  );
}

/** The rating, how it splits by star (each a filter), and how much has been answered. */
function Summary({
  loading,
  ratingAvg,
  ratingCount,
  stars,
  waiting,
  replied,
  filter,
  onFilter,
}: {
  loading: boolean;
  ratingAvg: number | null;
  ratingCount: number;
  stars: number[];
  waiting: number;
  replied: number;
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  const total = stars.reduce((sum, n) => sum + n, 0);
  const most = Math.max(1, ...stars);
  const share = total ? replied / total : 0;
  const c = 2 * Math.PI * 20;
  return (
    <div className={`rv-summary${loading ? ' is-loading' : ''}`}>
      <div className="rv-score">
        <strong>{ratingAvg === null ? '–' : ratingAvg.toFixed(1)}</strong>
        <Stars value={ratingAvg ?? 0} size={18} />
        <span>
          {ratingAvg === null ? 'No rating yet' : ratingCount === 1 ? 'from 1 review' : `from ${ratingCount.toLocaleString()} reviews`}
        </span>
      </div>

      <div className="rv-bars">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = stars[n - 1];
          return (
            <button
              key={n}
              type="button"
              className={`rv-bar${filter === n ? ' is-on' : ''}`}
              onClick={() => onFilter(n as Filter)}
              title={`Show ${n}-star reviews`}
            >
              <span className="rv-bar-label">
                {n} <Icon name="star" size={12} filled />
              </span>
              <span className="rv-bar-track">
                <i style={{ width: `${(count / most) * 100}%` }} />
              </span>
              <span className="rv-bar-count">{count.toLocaleString()}</span>
              <span className="rv-bar-pct">{total ? Math.round((count / total) * 100) : 0}%</span>
            </button>
          );
        })}
      </div>

      <div className="rv-reply-card">
        <span className="rv-reply-ring" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="58" height="58">
            <circle cx="24" cy="24" r="20" className="t" />
            <circle cx="24" cy="24" r="20" className="f" strokeDasharray={c} strokeDashoffset={c * (1 - share)} />
          </svg>
          <b>{Math.round(share * 100)}%</b>
        </span>
        <div>
          <strong>{total === 0 ? 'Nothing to answer' : waiting === 0 ? 'All answered' : `${waiting.toLocaleString()} waiting for a reply`}</strong>
          <span>
            {total === 0
              ? 'Replies show under each review, for everyone.'
              : `You have replied to ${replied.toLocaleString()} of ${total.toLocaleString()}. Every reader sees your reply.`}
          </span>
          {waiting > 0 && filter !== 'waiting' && (
            <button type="button" onClick={() => onFilter('waiting')}>
              Answer them <Icon name="arrowRight" size={14} stroke={2.2} />
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

/** A start for a reply, by how the review went — always edited before it is sent. */
function suggestions(review: Review): string[] {
  const name = review.displayName && review.displayName !== 'Anonymous' ? ` ${review.displayName.split(' ')[0]}` : '';
  const what = review.serviceName ? ` ${review.serviceName.toLowerCase()}` : ' visit';
  if (review.rating >= 4)
    return [
      `Thank you${name}! We're so glad you enjoyed your${what}. See you next time.`,
      `Thanks for taking the time to review us${name} — it means a lot to the team.`,
    ];
  if (review.rating === 3)
    return [
      `Thank you for the honest review${name}. We'd love to make your next${what} a five-star one.`,
      `Thanks${name} — we've shared this with the team. What would have made it better?`,
    ];
  return [
    `We're sorry${name}. That isn't the${what} we want for anyone. Please message us so we can put it right.`,
    `Thank you for telling us${name}. We've spoken with the team about this, and we'd like the chance to do better.`,
  ];
}

function ReviewRow({
  review,
  index,
  find,
  onSaved,
}: {
  review: Review;
  index: number;
  find: string;
  onSaved: () => void;
}) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState(review.responseText ?? '');
  const [open, setOpen] = useState(false);

  const hasReply = Boolean(review.responseText);
  const editable = review.responseAt ? withinEditWindow(review.responseAt) : false;
  const name = review.displayName ?? 'Anonymous';
  const shop = profile.data?.name ?? 'Your shop';
  const long = (review.comment?.length ?? 0) > 260;
  const tone = review.rating >= 4 ? 'good' : review.rating === 3 ? 'mid' : 'low';

  const save = useMutation({
    mutationFn: () =>
      hasReply ? updateReviewResponse(review.id, text.trim()) : respondToReview(review.id, text.trim()),
    onSuccess: () => {
      setComposing(false);
      onSaved();
    },
  });

  return (
    <li className={`rv-row tone-${tone}`} style={{ animationDelay: `${Math.min(index % PAGE, 8) * 30}ms` }}>
      <Avatar label={name} size={42} />
      <div className="rv-main">
        <div className="rv-head">
          <div className="rv-who">
            <strong>
              <Marked text={name} find={find} />
            </strong>
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

        {hasReply && !composing && (
          <div className="rv-reply">
            <span className="rv-reply-logo">
              {profile.data?.logoUrl ? <img src={profile.data.logoUrl} alt="" /> : initialsOf(shop)}
            </span>
            <div className="rv-reply-body">
              <div className="rv-reply-meta">
                <strong>Your reply</strong>
                <span>
                  {ago(review.responseAt!)}
                  {review.responseEditedAt && ' · edited'}
                </span>
                {editable ? (
                  <button type="button" className="rv-edit" onClick={() => setComposing(true)}>
                    <Icon name="pencil" size={13} /> Edit
                  </button>
                ) : (
                  // Saying why beats a button that earns a 400.
                  <span className="rv-locked" title={`Replies can only be changed within ${REVIEW_EDIT_WINDOW_DAYS} days of posting.`}>
                    <Icon name="clock" size={12} /> Final
                  </span>
                )}
              </div>
              <p>{review.responseText}</p>
            </div>
          </div>
        )}

        {!hasReply && !composing && (
          <div className="rv-ask">
            <span className="rv-waiting">
              <i /> Waiting for your reply
            </span>
            <button type="button" className="rv-reply-btn" onClick={() => setComposing(true)}>
              <Icon name="message" size={15} /> Reply
            </button>
          </div>
        )}

        {composing && (
          <form
            className="rv-compose"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            {!text && (
              <div className="rv-suggest">
                {suggestions(review).map((s) => (
                  <button key={s} type="button" onClick={() => setText(s)}>
                    <Icon name="sparkles" size={13} /> {s}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              maxLength={2000}
              autoFocus
              placeholder={
                review.rating <= 2
                  ? 'A calm, specific reply does more for the next reader than for this one.'
                  : 'Thank them, briefly.'
              }
            />
            {save.error && (
              <p className="error small" role="alert">
                {save.error instanceof ApiError ? save.error.message : 'That did not save.'}
              </p>
            )}
            <div className="rv-compose-foot">
              <span>Public, under the review. You can edit it for {REVIEW_EDIT_WINDOW_DAYS} days.</span>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setComposing(false);
                    setText(review.responseText ?? '');
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={save.isPending || text.trim() === ''}>
                  <Icon name="send" size={15} />
                  {save.isPending ? 'Saving…' : hasReply ? 'Save reply' : 'Post reply'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}
