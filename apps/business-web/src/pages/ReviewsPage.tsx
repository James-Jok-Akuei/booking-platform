import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Stars } from '../ui/Stars';
import './reviews.css';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** The reply is editable for a week after posting; the server enforces it. */
const withinEditWindow = (responseAt: string) =>
  (Date.now() - new Date(responseAt).getTime()) / 86_400_000 < REVIEW_EDIT_WINDOW_DAYS;

type Filter = 'all' | 'waiting' | 1 | 2 | 3 | 4 | 5;

/**
 * What customers said, and the one reply each gets (§92, §199).
 *
 * Replying is day-to-day work rather than configuration, so any active member
 * can do it — the server puts it with the STAFF-permitted actions, not the
 * owner-only ones, and this screen follows that.
 *
 * Hidden reviews are absent. The server excludes them for everyone including
 * the business, so this page shows exactly what a customer sees.
 */
export function ReviewsPage() {
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const [selected, setSelected] = useState<string | null>(null);

  const branches = locations.data ?? [];
  const locationId = selected ?? branches[0]?.id ?? null;

  return (
    <section className="rv">
      <header className="page-head">
        <div>
          <h1>Reviews</h1>
          <p className="muted">What customers said, and your reply. Everyone can see both.</p>
        </div>
      </header>

      <BranchPills
        branches={branches}
        value={locationId}
        onChange={setSelected}
        extra={(b) => (b.ratingCount > 0 ? `★ ${b.ratingAvg}` : null)}
      />

      {locations.isLoading && <div className="skeleton rv-skeleton" />}
      {branches.length === 0 && !locations.isLoading && (
        <p className="muted">Add a branch first, under Branches &amp; hours.</p>
      )}

      {locationId && <BranchReviews key={locationId} locationId={locationId} />}
    </section>
  );
}

function BranchReviews({ locationId }: { locationId: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const reviews = useQuery({
    queryKey: ['reviews', locationId],
    queryFn: () => listLocationReviews(locationId),
  });

  if (reviews.isLoading) return <div className="skeleton rv-skeleton" />;
  if (!reviews.data) return null;

  const { ratingAvg, ratingCount, reviews: rows } = reviews.data;
  const unanswered = rows.filter((review) => !review.responseText).length;
  const counts = [5, 4, 3, 2, 1].map((n) => ({ n, count: rows.filter((r) => r.rating === n).length }));
  const most = Math.max(1, ...counts.map((c) => c.count));
  const shown = rows.filter((r) =>
    filter === 'all' ? true : filter === 'waiting' ? !r.responseText : r.rating === filter,
  );
  const replied = rows.length - unanswered;

  return (
    <>
      <div className="rv-summary">
        <div className="rv-score">
          <strong>{ratingAvg === null ? '–' : ratingAvg.toFixed(1)}</strong>
          {ratingAvg !== null && <Stars value={ratingAvg} size={20} />}
          <span>
            {ratingAvg === null ? 'No rating yet' : ratingCount === 1 ? 'from 1 review' : `from ${ratingCount} reviews`}
          </span>
        </div>

        <div className="rv-bars">
          {counts.map(({ n, count }) => (
            <button
              key={n}
              type="button"
              className={`rv-bar${filter === n ? ' is-on' : ''}`}
              onClick={() => setFilter(filter === n ? 'all' : (n as Filter))}
              title={`Show ${n}-star reviews`}
            >
              <span className="rv-bar-label">
                {n} <Icon name="star" size={12} filled />
              </span>
              <span className="rv-bar-track">
                <i style={{ width: `${(count / most) * 100}%` }} />
              </span>
              <span className="rv-bar-count">{count}</span>
            </button>
          ))}
          {ratingCount > rows.length && <p className="rv-note">Counted from the latest {rows.length}.</p>}
        </div>

        <div className="rv-reply-card">
          <span className="rv-reply-ring" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="56" height="56">
              <circle cx="24" cy="24" r="20" className="t" />
              <circle
                cx="24"
                cy="24"
                r="20"
                className="f"
                strokeDasharray={2 * Math.PI * 20}
                strokeDashoffset={2 * Math.PI * 20 * (1 - (rows.length ? replied / rows.length : 0))}
              />
            </svg>
          </span>
          <div>
            <strong>{unanswered === 0 ? 'All answered' : `${unanswered} waiting for a reply`}</strong>
            <span>
              {rows.length === 0
                ? 'Nothing to answer yet.'
                : `You have replied to ${replied} of ${rows.length}. A reply is read by everyone who reads the review.`}
            </span>
            {unanswered > 0 && (
              <button type="button" className="dark" onClick={() => setFilter('waiting')}>
                Show them
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rv-filters">
        <button type="button" className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>
          All <span>{rows.length}</span>
        </button>
        <button type="button" className={filter === 'waiting' ? 'is-on' : ''} onClick={() => setFilter('waiting')}>
          Waiting for a reply <span>{unanswered}</span>
        </button>
        {typeof filter === 'number' && (
          <button type="button" className="is-on" onClick={() => setFilter('all')}>
            {filter} stars <Icon name="close" size={13} stroke={2.4} />
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div className="rv-empty">
          <span>
            <Icon name="star" size={28} />
          </span>
          <p>No reviews for this branch yet.</p>
        </div>
      )}
      {rows.length > 0 && shown.length === 0 && <p className="muted rv-none">Nothing here — try another filter.</p>}

      <ul className="rv-list">
        {shown.map((review, i) => (
          <ReviewRow key={review.id} review={review} locationId={locationId} index={i} />
        ))}
      </ul>
    </>
  );
}

function ReviewRow({ review, locationId, index }: { review: Review; locationId: string; index: number }) {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.responseText ?? '');

  const hasReply = Boolean(review.responseText);
  const editable = review.responseAt ? withinEditWindow(review.responseAt) : false;
  const name = review.displayName ?? 'Anonymous';
  const shop = profile.data?.name ?? 'Your shop';

  const save = useMutation({
    mutationFn: () =>
      hasReply ? updateReviewResponse(review.id, text.trim()) : respondToReview(review.id, text.trim()),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['reviews', locationId] });
    },
  });

  const tone = review.rating >= 4 ? 'good' : review.rating === 3 ? 'mid' : 'low';

  return (
    <li className={`rv-card tone-${tone}`} style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <div className="rv-head">
        <Avatar label={name} size={44} />
        <div className="rv-who">
          <strong>{name}</strong>
          <span>
            {when(review.createdAt)}
            {review.editedAt && ' · edited'}
          </span>
        </div>
        <span className={`rv-stars tone-${tone}`} title={`${review.rating} out of 5`}>
          <Stars value={review.rating} size={15} />
          <b>{review.rating}.0</b>
        </span>
      </div>

      {review.comment ? (
        <p className="rv-text">{review.comment}</p>
      ) : (
        <p className="rv-text is-empty">They left a rating but no words.</p>
      )}

      {hasReply && !editing && (
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
            </div>
            <p>{review.responseText}</p>
            {editable ? (
              <button type="button" className="link" onClick={() => setEditing(true)}>
                Edit reply
              </button>
            ) : (
              // Saying why beats a button that earns a 400.
              <span className="rv-locked">
                <Icon name="clock" size={13} /> Replies can only be changed within {REVIEW_EDIT_WINDOW_DAYS} days of
                posting.
              </span>
            )}
          </div>
        </div>
      )}

      {(!hasReply || editing) && (
        <form
          className="rv-compose"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {!hasReply && (
            <span className="rv-waiting">
              <i /> Waiting for your reply
            </span>
          )}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            maxLength={2000}
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
            <span>Everyone who reads the review sees your reply.</span>
            <div>
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setText(review.responseText ?? '');
                  }}
                >
                  Cancel
                </button>
              )}
              <button type="submit" className="primary" disabled={save.isPending || text.trim() === ''}>
                <Icon name="send" size={16} />
                {save.isPending ? 'Saving…' : hasReply ? 'Save reply' : 'Reply'}
              </button>
            </div>
          </div>
        </form>
      )}
    </li>
  );
}
